import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/connection.js";
import { fieldTypes } from "../src/db/schema.js";
import { createServices } from "../src/services.js";
import type { TemplateField } from "../src/templates/validation.js";

/**
 * Create isolated HTTP and domain fixtures, recording unexpected storage failures.
 * @param context The test cleanup context.
 * @returns In-memory storage, services, and an HTTP client.
 */
function fixture(context: TestContext) {
  const connection = openDatabase(":memory:");
  context.after(() => connection.close());
  const services = createServices(connection.db);
  const errors: unknown[] = [];
  const api = request(
    createApp(
      {
        error: (...args: unknown[]) => {
          errors.push(args);
        },
      },
      services,
    ),
  );
  return { ...connection, services, api, errors };
}

/**
 * Snapshot every domain table, including revisions, timestamps, counters, and tombstones.
 * @param f The isolated database fixture.
 * @returns Complete rows ordered by technical identifier.
 */
function snapshot(f: ReturnType<typeof fixture>) {
  return [
    "inventories",
    "inventory_groups",
    "inventory_fields",
    "inventory_field_options",
    "inventory_items",
    "inventory_item_values",
    "inventory_templates",
  ].map((table) =>
    f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
  );
}

/**
 * Build a populated source that exercises every supported field configuration.
 * @param f The isolated services.
 * @returns Source inventory, all field definitions, and its original item.
 */
function populatedSource(f: ReturnType<typeof fixture>) {
  const group = f.services.groups.create({ name: "Source group" });
  const inventory = f.services.inventories.create({
    name: "Original",
    description: "Source description",
    group_id: group.id,
  });
  const fields = fieldTypes.map((field_type) =>
    f.services.fields.create(inventory.id, {
      name: field_type,
      field_type,
      max_length: field_type === "text" ? 67 : null,
      is_sortable: false,
      reuse_deleted_ids: field_type === "id",
      options:
        field_type === "select" || field_type === "multiselect"
          ? [{ name: "One" }, { name: "Two" }]
          : [],
    }),
  );
  const item = f.services.items.create(inventory.id, {
    values: [{ field_id: fields[0]!.id, value: "Original content" }],
  });
  // Advance source counters; neither item data nor numbering belongs in a blueprint.
  f.services.items.create(inventory.id, {});
  return { inventory, fields, item };
}

/**
 * Capture a source at its latest coherent configuration revision.
 * @param f The isolated services.
 * @param inventoryId The source inventory identifier.
 * @returns A new independent blueprint.
 */
function capture(f: ReturnType<typeof fixture>, inventoryId: string) {
  return f.services.templates.create({
    name: "Blueprint",
    description: "Template description",
    source_inventory_id: inventoryId,
    expected_configuration_revision:
      f.services.inventories.get(inventoryId).configurationRevision,
  });
}

// Exercise public CRUD, replacement order, no-op revisions, and complete deletion clearing.
test("template HTTP CRUD preserves structure and uses revision-checked tombstones", async (context) => {
  const f = fixture(context);
  const response = await f.api
    .post("/inventory-templates")
    .send({
      name: "  Tools  ",
      fields: [{ name: "Title", field_type: "text" }],
    })
    .expect(201);
  const original = response.body;
  assert.equal(original.name, "Tools");
  assert.equal(original.description, null);
  assert.equal(original.revision, 1);
  assert.equal(original.fields[0].max_length, 255);
  assert.equal("deleted_at" in original, false);
  assert.ok(original.created_at);
  assert.deepEqual((await f.api.get("/inventory-templates").expect(200)).body, [
    original,
  ]);
  assert.deepEqual(
    (await f.api.get(`/inventory-templates/${original.id}`).expect(200)).body,
    original,
  );
  const changed = await f.api
    .patch(`/inventory-templates/${original.id}`)
    .send({
      expected_revision: 1,
      name: "Renamed",
      description: "Notes",
      fields: [
        { name: "Count", field_type: "number" },
        { name: "Title", field_type: "text", max_length: 20 },
      ],
    })
    .expect(200);
  assert.equal(changed.body.revision, 2);
  assert.deepEqual(
    changed.body.fields.map((field: TemplateField) => field.name),
    ["Count", "Title"],
  );
  const unchanged = await f.api
    .patch(`/inventory-templates/${original.id}`)
    .send({ expected_revision: 2 })
    .expect(200);
  assert.equal(unchanged.body.revision, 3);
  assert.deepEqual(unchanged.body.fields, changed.body.fields);
  await f.api
    .delete(`/inventory-templates/${original.id}`)
    .send({ expected_revision: 3 })
    .expect(204);
  assert.deepEqual(
    (await f.api.get("/inventory-templates").expect(200)).body,
    [],
  );
  await f.api.get(`/inventory-templates/${original.id}`).expect(404);
  const tombstone = f.sqlite
    .prepare("SELECT * FROM inventory_templates WHERE id = ?")
    .get(original.id) as Record<string, unknown>;
  assert.equal(tombstone.name, "");
  assert.equal(tombstone.description, null);
  assert.equal(tombstone.fields, "[]");
  assert.equal(tombstone.revision, 4);
  assert.ok(tombstone.deleted_at);
});

// Capture every field setting, exclude all source identities/data, and instantiate with fresh counters.
test("captures all field types and atomically creates independent empty inventories", async (context) => {
  const f = fixture(context);
  const source = populatedSource(f);
  const before = snapshot(f).slice(0, 6);
  const response = await f.api
    .post("/inventory-templates")
    .send({
      name: "Blueprint",
      source_inventory_id: source.inventory.id,
      expected_configuration_revision: f.services.inventories.get(
        source.inventory.id,
      ).configurationRevision,
    })
    .expect(201);
  const template = f.services.templates.get(response.body.id);
  assert.deepEqual(snapshot(f).slice(0, 6), before);
  assert.deepEqual(
    template.fields.map((field) => field.field_type),
    fieldTypes,
  );
  assert.equal(template.fields[0]!.max_length, 67);
  assert.ok(template.fields.every((field) => !field.is_sortable));
  assert.ok(template.fields.at(-1)!.reuse_deleted_ids);
  for (const field of source.fields)
    assert.ok(!JSON.stringify(template.fields).includes(field.id));
  assert.ok(!JSON.stringify(template.fields).includes(source.item.id));
  const destination = f.services.groups.create({ name: "Destination" });
  for (let pass = 0; pass < 2; pass++) {
    const created = await f.api
      .post(`/inventory-templates/${template.id}/inventories`)
      .send({
        expected_revision: 1,
        name: `Copy ${pass}`,
        description: "Own description",
        group_id: destination.id,
      })
      .expect(201);
    assert.notEqual(created.body.inventory.id, source.inventory.id);
    assert.equal(created.body.inventory.group_id, destination.id);
    assert.equal(created.body.inventory.description, "Own description");
    assert.deepEqual(f.services.items.list(created.body.inventory.id), []);
    assert.deepEqual(
      created.body.fields.map((field: { position: number }) => field.position),
      fieldTypes.map((_, index) => index),
    );
    for (const [index, field] of created.body.fields.entries()) {
      assert.notEqual(field.id, source.fields[index]!.id);
      for (const option of field.options)
        assert.ok(
          !source.fields[index]!.options.some(
            (original) => original.id === option.id,
          ),
        );
    }
    const idField = created.body.fields.at(-1);
    assert.equal(
      f.services.fields.get(created.body.inventory.id, idField.id)
        .lastAssignedId,
      0,
    );
    assert.equal(
      f.services.items
        .create(created.body.inventory.id, {})
        .values.find((value) => value.fieldId === idField.id)?.value,
      1,
    );
    assert.equal(
      f.services.inventories.get(created.body.inventory.id)
        .configurationRevision,
      created.body.inventory.configuration_revision,
    );
  }
  assert.equal(f.services.templates.get(template.id).revision, 1);
});

// Existing inventories may have zero options, duplicate names, and more than 100 later-added options.
test("preserves valid existing empty and extended selection configurations without copying deleted content", (context) => {
  const f = fixture(context);
  const inventory = f.services.inventories.create({ name: "Selections" });
  const empty = f.services.fields.create(inventory.id, {
    name: "Empty",
    field_type: "select",
    options: [{ name: "Removed" }],
  });
  f.services.options.delete(inventory.id, empty.id, empty.options[0]!.id);
  const extended = f.services.fields.create(inventory.id, {
    name: "Extended",
    field_type: "multiselect",
    options: [{ name: "Repeated" }],
  });
  for (let i = 0; i < 101; i++)
    f.services.options.create(inventory.id, extended.id, { name: "Repeated" });
  const deleted = f.services.fields.create(inventory.id, {
    name: "Deleted",
    field_type: "text",
  });
  f.services.fields.delete(inventory.id, deleted.id);
  const template = capture(f, inventory.id);
  assert.deepEqual(
    template.fields.map((field) => field.name),
    ["Empty", "Extended"],
  );
  assert.deepEqual(template.fields[0]!.options, []);
  assert.equal(template.fields[1]!.options.length, 102);
  const copy = f.services.templates.instantiate(template.id, {
    name: "Copy",
    expected_revision: 1,
  });
  assert.deepEqual(
    copy.fields.map((field) => field.options.map((option) => option.name)),
    [[], Array<string>(102).fill("Repeated")],
  );
});

// Later source/template edits and deletion cannot propagate into already materialized inventories.
test("source, template, and generated inventories remain independent", (context) => {
  const f = fixture(context);
  const source = populatedSource(f);
  const template = capture(f, source.inventory.id);
  const copy = f.services.templates.instantiate(template.id, {
    name: "Copy",
    expected_revision: 1,
  });
  f.services.fields.update(source.inventory.id, source.fields[0]!.id, {
    name: "Source renamed",
  });
  assert.equal(f.services.templates.get(template.id).fields[0]!.name, "text");
  f.services.templates.update(template.id, {
    expected_revision: 1,
    fields: [{ name: "Replacement", field_type: "number" }],
  });
  assert.deepEqual(f.services.inventoryEditor.read(copy.inventory.id), copy);
  f.services.inventories.delete(source.inventory.id);
  const second = f.services.templates.instantiate(template.id, {
    name: "Second",
    expected_revision: 2,
  });
  assert.deepEqual(
    second.fields.map((field) => field.name),
    ["Replacement"],
  );
  f.services.templates.delete(template.id, { expected_revision: 2 });
  assert.deepEqual(f.services.inventoryEditor.read(copy.inventory.id), copy);
  assert.deepEqual(
    f.services.inventoryEditor.read(second.inventory.id),
    second,
  );
});

// Empty sources and explicit empty definitions are useful starting blueprints.
test("supports empty templates without inheriting source metadata or membership", (context) => {
  const f = fixture(context);
  const source = f.services.inventories.create({
    name: "Source",
    description: "Source notes",
  });
  const template = capture(f, source.id);
  const copy = f.services.templates.instantiate(template.id, {
    name: "Empty",
    expected_revision: 1,
  });
  assert.equal(copy.inventory.name, "Empty");
  assert.equal(copy.inventory.description, null);
  assert.equal(copy.inventory.groupId, null);
  assert.deepEqual(copy.fields, []);
});

// A stale source snapshot must not create a misleading blueprint or mutate the source revision.
test("rejects stale or missing source inventories without writing a template", async (context) => {
  const f = fixture(context);
  const inventory = f.services.inventories.create({ name: "Source" });
  f.services.fields.create(inventory.id, { name: "Later", field_type: "text" });
  const before = snapshot(f);
  const stale = await f.api
    .post("/inventory-templates")
    .send({
      name: "Stale",
      source_inventory_id: inventory.id,
      expected_configuration_revision: 1,
    })
    .expect(409);
  assert.equal(stale.body.detail.code, "inventory_configuration_conflict");
  assert.deepEqual(snapshot(f), before);
  await f.api
    .post("/inventory-templates")
    .send({
      name: "Missing",
      source_inventory_id: "missing",
      expected_configuration_revision: 1,
    })
    .expect(404);
  f.services.inventories.delete(inventory.id);
  const deleted = snapshot(f);
  await f.api
    .post("/inventory-templates")
    .send({
      name: "Deleted",
      source_inventory_id: inventory.id,
      expected_configuration_revision: 1,
    })
    .expect(404);
  assert.deepEqual(snapshot(f), deleted);
});

// Conflicts keep both template content and every existing inventory unchanged.
test("rejects stale template updates, deletions, and instantiation without writes", async (context) => {
  const f = fixture(context);
  const template = f.services.templates.create({
    name: "Blueprint",
    fields: [],
  });
  f.services.templates.update(template.id, {
    expected_revision: 1,
    name: "Changed",
  });
  const before = snapshot(f);
  const path = `/inventory-templates/${template.id}`;
  for (const response of [
    await f.api
      .patch(path)
      .send({ expected_revision: 1, name: "Stale" })
      .expect(409),
    await f.api.delete(path).send({ expected_revision: 1 }).expect(409),
    await f.api
      .post(`${path}/inventories`)
      .send({ expected_revision: 1, name: "Stale" })
      .expect(409),
  ])
    assert.equal(response.body.detail.code, "inventory_template_conflict");
  assert.deepEqual(snapshot(f), before);
  f.sqlite
    .prepare("UPDATE inventory_templates SET revision = ? WHERE id = ?")
    .run(Number.MAX_SAFE_INTEGER, template.id);
  const exhausted = snapshot(f);
  await f.api
    .patch(path)
    .send({ expected_revision: Number.MAX_SAFE_INTEGER, name: "Overflow" })
    .expect(409);
  await f.api
    .delete(path)
    .send({ expected_revision: Number.MAX_SAFE_INTEGER })
    .expect(409);
  assert.deepEqual(snapshot(f), exhausted);
});

// Strict payloads prevent accidentally persisting item data, foreign IDs, counters, or view preferences.
test("validates blueprint structures and source variants before any writes", async (context) => {
  const f = fixture(context);
  const field = { name: "Title", field_type: "text" };
  const invalid = [
    {},
    { name: " " },
    { name: "Blueprint" },
    { name: "Blueprint", fields: [], items: [] },
    {
      name: "Blueprint",
      fields: [],
      source_inventory_id: "source",
      expected_configuration_revision: 1,
    },
    { name: "Blueprint", source_inventory_id: "source" },
    { name: "Blueprint", fields: [{ ...field, id: "foreign" }] },
    { name: "Blueprint", fields: [{ ...field, last_assigned_id: 50 }] },
    { name: "Blueprint", fields: [{ ...field, max_length: 0 }] },
    { name: "Blueprint", fields: [{ ...field, max_length: 1001 }] },
    { name: "Blueprint", fields: [{ ...field, reuse_deleted_ids: true }] },
    {
      name: "Blueprint",
      fields: [{ ...field, field_type: "number", max_length: 20 }],
    },
    { name: "Blueprint", fields: [{ ...field, options: [{ name: "Bad" }] }] },
    {
      name: "Blueprint",
      fields: [{ ...field, field_type: "select", options: [{ name: " " }] }],
    },
    {
      name: "Blueprint",
      fields: [
        {
          ...field,
          field_type: "select",
          options: [{ name: "Choice", id: "source" }],
        },
      ],
    },
    { name: "Blueprint", fields: [{ ...field, field_type: "unsupported" }] },
  ];
  const before = snapshot(f);
  for (const input of invalid)
    await f.api.post("/inventory-templates").send(input).expect(422);
  assert.deepEqual(snapshot(f), before);
});

// Every destructive operation requires a strict positive safe revision, not coerced input.
test("requires safe revisions and strict update and instantiate payloads", async (context) => {
  const f = fixture(context);
  const template = f.services.templates.create({
    name: "Blueprint",
    fields: [],
  });
  const before = snapshot(f);
  const path = `/inventory-templates/${template.id}`;
  for (const expected_revision of [
    undefined,
    null,
    0,
    -1,
    1.5,
    "1",
    true,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    await f.api
      .patch(path)
      .send({ expected_revision, name: "Changed" })
      .expect(422);
    await f.api.delete(path).send({ expected_revision }).expect(422);
    await f.api
      .post(`${path}/inventories`)
      .send({ expected_revision, name: "Copy" })
      .expect(422);
  }
  await f.api
    .patch(path)
    .send({ expected_revision: 1, source_inventory_id: "unexpected" })
    .expect(422);
  await f.api
    .patch(path)
    .send({
      expected_revision: 1,
      fields: [
        { name: "Bad", field_type: "number", options: [{ name: "Option" }] },
      ],
    })
    .expect(422);
  await f.api
    .post(`${path}/inventories`)
    .send({ expected_revision: 1, name: "Copy", columnWidths: {} })
    .expect(422);
  await f.api
    .post(`${path}/inventories`)
    .send({ expected_revision: 1, name: "Copy", group_id: "missing" })
    .expect(404);
  const group = f.services.groups.create({ name: "Deleted" });
  f.services.groups.delete(group.id);
  const afterGroup = snapshot(f);
  await f.api
    .post(`${path}/inventories`)
    .send({ expected_revision: 1, name: "Copy", group_id: group.id })
    .expect(404);
  assert.deepEqual(snapshot(f), afterGroup);
  assert.deepEqual(
    snapshot(f).filter((_, index) => index !== 1),
    before.filter((_, index) => index !== 1),
  );
});

// Missing and deleted blueprints cannot be modified or used again.
test("returns not found for missing or deleted templates", async (context) => {
  const f = fixture(context);
  const template = f.services.templates.create({ name: "Deleted", fields: [] });
  f.services.templates.delete(template.id, { expected_revision: 1 });
  const before = snapshot(f);
  for (const id of ["missing", template.id]) {
    const path = `/inventory-templates/${id}`;
    await f.api.get(path).expect(404);
    await f.api
      .patch(path)
      .send({ expected_revision: 1, name: "Changed" })
      .expect(404);
    await f.api.delete(path).send({ expected_revision: 1 }).expect(404);
    await f.api
      .post(`${path}/inventories`)
      .send({ expected_revision: 1, name: "Copy" })
      .expect(404);
  }
  assert.deepEqual(snapshot(f), before);
});

// A late SQL failure must roll back the new inventory, fields, options, and configuration triggers.
test("rolls back all materialized records after a late option storage failure", async (context) => {
  const f = fixture(context);
  const source = populatedSource(f);
  const template = capture(f, source.inventory.id);
  const before = snapshot(f);
  f.sqlite.exec(
    "CREATE TRIGGER reject_template_option BEFORE INSERT ON inventory_field_options WHEN NEW.position = 1 BEGIN SELECT RAISE(ABORT, 'synthetic option failure'); END",
  );
  await f.api
    .post(`/inventory-templates/${template.id}/inventories`)
    .send({ expected_revision: 1, name: "Must roll back" })
    .expect(500);
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.errors.length, 1);
  f.sqlite.exec("DROP TRIGGER reject_template_option");
  await f.api
    .post(`/inventory-templates/${template.id}/inventories`)
    .send({ expected_revision: 1, name: "Retry" })
    .expect(201);
});

// Revision claims are rolled back together with failed content writes and failed deletion clearing.
test("rolls back template revisions and content on update and delete storage failures", async (context) => {
  const f = fixture(context);
  const template = f.services.templates.create({
    name: "Blueprint",
    fields: [{ name: "Title", field_type: "text" }],
  });
  const before = snapshot(f);
  f.sqlite.exec(
    "CREATE TRIGGER reject_template_content BEFORE UPDATE OF fields ON inventory_templates BEGIN SELECT RAISE(ABORT, 'synthetic template failure'); END",
  );
  await f.api
    .patch(`/inventory-templates/${template.id}`)
    .send({ expected_revision: 1, name: "Changed", fields: [] })
    .expect(500);
  assert.deepEqual(snapshot(f), before);
  await f.api
    .delete(`/inventory-templates/${template.id}`)
    .send({ expected_revision: 1 })
    .expect(500);
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.errors.length, 2);
});

// Field selection belongs to one template revision and preserves its order, options, and independent IDs.
test("creates only selected template fields in template order without changing the blueprint", async (context) => {
  const f = fixture(context);
  const template = f.services.templates.create({
    name: "Blueprint",
    fields: [
      { name: "Number", field_type: "id" },
      { name: "Omitted", field_type: "text", is_required: true },
      {
        name: "Choice",
        field_type: "select",
        options: [{ name: "One" }, { name: "Two" }],
      },
    ],
  });
  const path = `/inventory-templates/${template.id}/inventories`;
  const response = await f.api
    .post(path)
    .send({ name: "Subset", expected_revision: 1, field_indexes: [2, 0] })
    .expect(201);
  const copy = f.services.inventoryEditor.read(response.body.inventory.id);
  assert.deepEqual(
    copy.fields.map((field) => [field.name, field.position]),
    [
      ["Number", 0],
      ["Choice", 1],
    ],
  );
  assert.deepEqual(
    copy.fields[1]!.options.map((option) => option.name),
    ["One", "Two"],
  );
  assert.equal(
    f.services.items.create(copy.inventory.id, {}).values[0]!.value,
    1,
  );
  assert.deepEqual(f.services.templates.get(template.id), template);
  const empty = await f.api
    .post(path)
    .send({ name: "Empty", expected_revision: 1, field_indexes: [] })
    .expect(201);
  assert.deepEqual(empty.body.fields, []);
  assert.deepEqual(f.services.templates.get(template.id), template);
});

// Invalid positions and stale revisions are rejected before any new inventory or field is written.
test("rejects invalid template field selections atomically", async (context) => {
  const f = fixture(context);
  const template = f.services.templates.create({
    name: "Blueprint",
    fields: [{ name: "Title", field_type: "text" }],
  });
  const before = snapshot(f);
  const path = `/inventory-templates/${template.id}/inventories`;
  for (const field_indexes of [
    [-1],
    [0.5],
    ["0"],
    [true],
    [0, 0],
    [1],
    [Number.MAX_SAFE_INTEGER],
    null,
    "0",
  ]) {
    await f.api
      .post(path)
      .send({ name: "Invalid", expected_revision: 1, field_indexes })
      .expect(422);
    assert.deepEqual(snapshot(f), before);
  }
  f.services.templates.update(template.id, {
    expected_revision: 1,
    fields: [],
  });
  const changed = snapshot(f);
  const conflict = await f.api
    .post(path)
    .send({ name: "Stale", expected_revision: 1, field_indexes: [0] })
    .expect(409);
  assert.equal(conflict.body.detail.code, "inventory_template_conflict");
  assert.deepEqual(snapshot(f), changed);
});
