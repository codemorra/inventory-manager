import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { openDatabase, type DatabaseConnection } from "../src/db/connection.js";
import { createServices } from "../src/services.js";
import { createApp } from "../src/app.js";

/**
 * Prepare isolated inventory editor data and an HTTP client.
 * @param context The test cleanup context.
 * @returns The database, services, client, and existing inventory configuration.
 */
function fixture(context: TestContext) {
  const connection = openDatabase(":memory:");
  context.after(() => connection.close());
  const services = createServices(connection.db);
  const errors: unknown[] = [];
  const api = request(
    createApp({ error: (_message, error) => errors.push(error) }, services),
  );
  const group = services.groups.create({ name: "Technology" });
  const inventory = services.inventories.create({
    name: "Cables",
    group_id: group.id,
  });
  const title = services.fields.create(inventory.id, {
    name: "Title",
    field_type: "text",
    max_length: 80,
  });
  const type = services.fields.create(inventory.id, {
    name: "Type",
    field_type: "select",
    options: [{ name: "USB" }, { name: "HDMI" }],
  });
  const [usb, hdmi] = type.options;
  assert(usb && hdmi);
  const item = services.items.create(inventory.id, {
    values: [
      { field_id: title.id, value: "USB-C cable" },
      { field_id: type.id, value: usb.id },
    ],
  });
  return {
    ...connection,
    services,
    errors,
    api,
    inventory,
    title,
    type,
    usb,
    hdmi,
    item,
    group,
  };
}

/**
 * Capture every domain row, including lifecycle timestamps and tombstones.
 * @param connection The test database connection.
 * @returns A complete snapshot for rollback and preservation assertions.
 */
function snapshot(connection: DatabaseConnection) {
  return [
    "inventory_groups",
    "inventories",
    "inventory_fields",
    "inventory_field_options",
    "inventory_items",
    "inventory_item_values",
  ].map((table) =>
    connection.sqlite.prepare("SELECT * FROM " + table + " ORDER BY id").all(),
  );
}

// Test one atomic order containing saved and new fields without rewriting existing entries.
test("saves field order and settings with new draft fields and preserves old items", async (context) => {
  const f = fixture(context);
  const response = await f.api
    .patch(`/inventories/${f.inventory.id}/configuration`)
    .send({
      inventory: { name: "Cable collection" },
      fields: [
        {
          action: "update",
          field_id: f.title.id,
          data: { is_required: true, is_sortable: false },
        },
        {
          action: "create",
          client_id: "draft-link",
          data: {
            name: "Manual",
            field_type: "url",
            is_required: true,
            is_sortable: false,
          },
        },
        {
          action: "create",
          client_id: "draft-duration",
          data: { name: "Usage", field_type: "duration" },
        },
      ],
      field_order: [
        { client_id: "draft-duration" },
        { field_id: f.type.id },
        { client_id: "draft-link" },
        { field_id: f.title.id },
      ],
    })
    .expect(200);
  assert.deepEqual(
    response.body.fields.map((field: { name: string; position: number }) => [
      field.name,
      field.position,
    ]),
    [
      ["Usage", 0],
      ["Type", 1],
      ["Manual", 2],
      ["Title", 3],
    ],
  );
  assert.equal(response.body.fields[2].is_required, true);
  assert.equal(response.body.fields[2].is_sortable, false);
  assert.equal(response.body.fields[3].is_required, true);
  assert.equal(response.body.fields[3].is_sortable, false);
  assert.notEqual(response.body.fields[2].id, "draft-link");
  assert.deepEqual(f.services.items.read(f.inventory.id, f.item.id), f.item);
  assert.equal(response.body.inventory.group_id, f.group.id);
  assert.deepEqual(
    f.services.fields.list(f.inventory.id).map((field) => field.id),
    response.body.fields.map((field: { id: string }) => field.id),
  );
});

// Test normalized positions, unchanged no-op timestamps, and deleting the last active fields.
test("reorders surviving fields and preserves no-op order saves", async (context) => {
  const f = fixture(context);
  await f.api
    .patch(`/inventories/${f.inventory.id}/configuration`)
    .send({
      fields: [{ action: "delete", field_id: f.title.id }],
      field_order: [{ field_id: f.type.id }],
    })
    .expect(200);
  assert.equal(f.services.fields.get(f.inventory.id, f.type.id).position, 0);
  const before = snapshot(f);
  await f.api
    .patch(`/inventories/${f.inventory.id}/configuration`)
    .send({
      field_order: [{ field_id: f.type.id }],
    })
    .expect(200);
  assert.deepEqual(snapshot(f), before);
  await f.api
    .patch(`/inventories/${f.inventory.id}/configuration`)
    .send({
      fields: [{ action: "delete", field_id: f.type.id }],
      field_order: [],
    })
    .expect(200);
  assert.deepEqual(f.services.fields.list(f.inventory.id), []);
});

// Test strict references, final-set completeness, and rollback of metadata, flags, fields, and options.
test("rejects invalid field orders without persisting any draft changes", async (context) => {
  const f = fixture(context);
  const other = f.services.inventories.create({ name: "Other" });
  const foreign = f.services.fields.create(other.id, {
    name: "Foreign",
    field_type: "number",
  });
  const before = snapshot(f);
  const orders = [
    [],
    [{ field_id: f.title.id }],
    [
      { field_id: f.title.id },
      { field_id: f.title.id },
      { client_id: "draft" },
    ],
    [
      { field_id: f.title.id },
      { field_id: foreign.id },
      { client_id: "draft" },
    ],
    [{ field_id: f.title.id }, { field_id: "missing" }, { client_id: "draft" }],
    [
      { field_id: f.title.id },
      { field_id: f.type.id },
      { client_id: "missing" },
    ],
    [{ field_id: f.title.id }, { field_id: f.type.id }, { field_id: "draft" }],
    [
      { field_id: f.title.id, client_id: "draft" },
      { field_id: f.type.id },
      { client_id: "draft" },
    ],
    [f.title.id, f.type.id, "draft"],
  ];
  for (const field_order of orders) {
    await f.api
      .patch(`/inventories/${f.inventory.id}/configuration`)
      .send({
        inventory: { name: "Changed" },
        fields: [
          {
            action: "update",
            field_id: f.title.id,
            data: { is_required: true, is_sortable: false },
          },
          {
            action: "create",
            client_id: "draft",
            data: { name: "New", field_type: "number" },
          },
        ],
        options: [
          {
            action: "update",
            field_id: f.type.id,
            option_id: f.usb.id,
            data: { name: "Changed" },
          },
        ],
        field_order,
      })
      .expect(422);
    assert.deepEqual(snapshot(f), before);
  }
  const invalidDrafts = [
    {
      fields: [{ action: "delete", field_id: f.title.id }],
      field_order: [{ field_id: f.title.id }, { field_id: f.type.id }],
    },
    {
      fields: [
        { action: "update", field_id: f.title.id, data: { position: 1 } },
      ],
      field_order: [{ field_id: f.type.id }, { field_id: f.title.id }],
    },
    {
      fields: [
        {
          action: "create",
          client_id: "same",
          data: { name: "One", field_type: "number" },
        },
        {
          action: "create",
          client_id: "same",
          data: { name: "Two", field_type: "number" },
        },
      ],
    },
    {
      fields: [
        {
          action: "create",
          data: { name: "Unreferenced", field_type: "number" },
        },
      ],
      field_order: [{ field_id: f.title.id }, { field_id: f.type.id }],
    },
  ];
  for (const draft of invalidDrafts) {
    await f.api
      .patch(`/inventories/${f.inventory.id}/configuration`)
      .send(draft)
      .expect(422);
    assert.deepEqual(snapshot(f), before);
  }
});

// Test that a database failure during reordering rolls back earlier field and metadata changes.
test("rolls back the entire draft when writing a field position fails", async (context) => {
  const f = fixture(context);
  const before = snapshot(f);
  f.sqlite
    .exec(`CREATE TRIGGER reject_reorder BEFORE UPDATE OF position ON inventory_fields
    WHEN NEW.position = 1 BEGIN SELECT RAISE(ABORT, 'Position write failed'); END`);
  await f.api
    .patch(`/inventories/${f.inventory.id}/configuration`)
    .send({
      inventory: { name: "Changed" },
      fields: [
        { action: "update", field_id: f.title.id, data: { is_required: true } },
      ],
      field_order: [{ field_id: f.type.id }, { field_id: f.title.id }],
    })
    .expect(500);
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.errors.length, 1);
});

// Test a mixed save, stable identifiers, public DTOs, and preservation of unrelated data.
test("saves metadata, new fields, renames, deletions, and options together", async (context) => {
  const f = fixture(context);
  const result = await f.api
    .patch(`/inventories/${f.inventory.id}/configuration`)
    .send({
      inventory: { name: "  Cable collection  ", description: "Desk supplies" },
      fields: [
        { action: "update", field_id: f.title.id, data: { name: "Cable" } },
        { action: "create", data: { name: "Length", field_type: "number" } },
        {
          action: "create",
          data: {
            name: "Status",
            field_type: "select",
            options: [{ name: "Tested" }],
          },
        },
      ],
      options: [
        {
          action: "update",
          field_id: f.type.id,
          option_id: f.usb.id,
          data: { name: "USB-C" },
        },
        { action: "delete", field_id: f.type.id, option_id: f.hdmi.id },
        {
          action: "create",
          field_id: f.type.id,
          data: { name: "DisplayPort" },
        },
      ],
    })
    .expect(200);
  assert.equal(result.body.inventory.name, "Cable collection");
  assert.equal(result.body.inventory.group_id, f.group.id);
  assert.equal(result.body.inventory.description, "Desk supplies");
  assert.deepEqual(
    result.body.fields.map((field: { name: string }) => field.name),
    ["Cable", "Type", "Length", "Status"],
  );
  assert.equal(result.body.fields[0].id, f.title.id);
  assert.equal(result.body.fields[0].field_type, "text");
  assert.equal(result.body.fields[0].max_length, 80);
  assert.equal(result.body.fields[1].options[0].id, f.usb.id);
  assert.deepEqual(
    result.body.fields[1].options.map(
      (option: { name: string }) => option.name,
    ),
    ["USB-C", "DisplayPort"],
  );
  assert.equal(result.body.fields[3].options[0].name, "Tested");
  assert.deepEqual(f.services.items.read(f.inventory.id, f.item.id), f.item);
  const tombstone = f.sqlite
    .prepare("SELECT * FROM inventory_field_options WHERE id = ?")
    .get(f.hdmi.id) as { name: string; deleted_at: string };
  assert.equal(tombstone.name, "");
  assert.ok(tombstone.deleted_at);
});

// Test that mixed deletions and creations append new records without reusing occupied positions.
test("appends new fields and options after surviving positions when a draft deletes earlier rows", (context) => {
  const f = fixture(context);
  const result = f.services.inventoryEditor.save(f.inventory.id, {
    fields: [
      { action: "delete", field_id: f.title.id },
      { action: "create", data: { name: "Length", field_type: "number" } },
    ],
    options: [
      { action: "delete", field_id: f.type.id, option_id: f.usb.id },
      { action: "create", field_id: f.type.id, data: { name: "DisplayPort" } },
    ],
  });
  assert.deepEqual(
    result.fields.map((field) => [field.name, field.position]),
    [
      ["Type", 1],
      ["Length", 2],
    ],
  );
  assert.deepEqual(
    result.fields[0]!.options.map((option) => [option.name, option.position]),
    [
      ["HDMI", 1],
      ["DisplayPort", 2],
    ],
  );
});

// Test no-op saves, unchanged timestamps, and an empty active selection option list.
test("preserves no-op saves and permits deleting all existing options", async (context) => {
  const f = fixture(context);
  const before = snapshot(f);
  await f.api
    .patch(`/inventories/${f.inventory.id}/configuration`)
    .send({})
    .expect(200);
  assert.deepEqual(snapshot(f), before);
  f.services.inventoryEditor.save(f.inventory.id, {
    options: [f.usb, f.hdmi].map((option) => ({
      action: "delete",
      field_id: f.type.id,
      option_id: option.id,
    })),
  });
  assert.deepEqual(
    f.services.fields.read(f.inventory.id, f.type.id).options,
    [],
  );
  assert.deepEqual(f.services.items.read(f.inventory.id, f.item.id), f.item);
});

// Test that removing a field keeps its tombstone, stored values, and child option history.
test("field deletion preserves existing item values and option records", async (context) => {
  const f = fixture(context);
  const result = await f.api
    .patch(`/inventories/${f.inventory.id}/configuration`)
    .send({
      fields: [{ action: "delete", field_id: f.type.id }],
    })
    .expect(200);
  assert.equal(result.body.fields.length, 1);
  const field = f.sqlite
    .prepare("SELECT * FROM inventory_fields WHERE id = ?")
    .get(f.type.id) as { name: string; deleted_at: string };
  assert.equal(field.name, "");
  assert.ok(field.deleted_at);
  const optionCount = f.sqlite
    .prepare(
      "SELECT count(*) AS count FROM inventory_field_options WHERE field_id = ?",
    )
    .get(f.type.id) as { count: number };
  assert.equal(optionCount.count, 2);
  assert.deepEqual(f.services.items.read(f.inventory.id, f.item.id), f.item);
});

// Test validation and scope failures without retaining any earlier writes in the batch.
test("rejects invalid or conflicting changes and rolls back the entire draft", async (context) => {
  const f = fixture(context);
  const foreign = f.services.inventories.create({ name: "Other" });
  const foreignField = f.services.fields.create(foreign.id, {
    name: "Foreign",
    field_type: "text",
  });
  const foreignSelect = f.services.fields.create(foreign.id, {
    name: "Choice",
    field_type: "select",
    options: [{ name: "A" }],
  });
  const foreignOption = foreignSelect.options[0]!;
  const invalidCases = [
    {
      fields: [
        {
          action: "update",
          field_id: f.title.id,
          data: { field_type: "number" },
        },
      ],
      status: 422,
    },
    {
      fields: [
        { action: "update", field_id: f.title.id, data: { max_length: 200 } },
      ],
      status: 422,
    },
    {
      fields: [{ action: "create", data: { name: " ", field_type: "text" } }],
      status: 422,
    },
    {
      fields: [
        {
          action: "create",
          data: { name: "Select", field_type: "select", options: [] },
        },
      ],
      status: 422,
    },
    {
      fields: [
        { action: "update", field_id: foreignField.id, data: { name: "Bad" } },
      ],
      status: 404,
    },
    { fields: [{ action: "delete", field_id: "missing" }], status: 404 },
    {
      fields: [
        { action: "delete", field_id: f.title.id },
        { action: "update", field_id: f.title.id, data: { name: "Again" } },
      ],
      status: 422,
    },
    {
      fields: [{ action: "delete", field_id: f.type.id }],
      options: [
        { action: "create", field_id: f.type.id, data: { name: "Hidden" } },
      ],
      status: 422,
    },
    {
      options: [
        {
          action: "create",
          field_id: f.title.id,
          data: { name: "Unsupported" },
        },
      ],
      status: 422,
    },
    {
      options: [
        {
          action: "update",
          field_id: f.type.id,
          option_id: foreignOption.id,
          data: { name: "Foreign" },
        },
      ],
      status: 404,
    },
    {
      options: [
        { action: "delete", field_id: f.type.id, option_id: f.usb.id },
        {
          action: "update",
          field_id: f.type.id,
          option_id: f.usb.id,
          data: { name: "Again" },
        },
      ],
      status: 422,
    },
    {
      options: [
        { action: "delete", field_id: f.type.id, option_id: "missing" },
      ],
      status: 404,
    },
  ];
  for (const { status, fields = [], options = [] } of invalidCases) {
    const before = snapshot(f);
    await f.api
      .patch(`/inventories/${f.inventory.id}/configuration`)
      .send({
        inventory: { name: "Must roll back" },
        fields: [{ action: "create", data: { name: "Temporary" } }, ...fields],
        options,
      })
      .expect(status);
    assert.deepEqual(snapshot(f), before);
  }
  await f.api.patch("/inventories/missing/configuration").send({}).expect(404);
  const before = snapshot(f);
  await f.api
    .patch(`/inventories/${f.inventory.id}/configuration`)
    .send({ inventory: { group_id: null } })
    .expect(422);
  assert.deepEqual(snapshot(f), before);
});

// Test rollback of metadata, inserts, renames, and tombstones after an actual SQL failure.
test("rolls back persistence failures and permits resubmitting the same draft", async (context) => {
  const f = fixture(context);
  const before = snapshot(f);
  const draft = {
    inventory: { name: "Updated" },
    fields: [
      { action: "update", field_id: f.title.id, data: { name: "Renamed" } },
      { action: "create", data: { name: "New field" } },
    ],
    options: [
      { action: "delete", field_id: f.type.id, option_id: f.usb.id },
      {
        action: "update",
        field_id: f.type.id,
        option_id: f.hdmi.id,
        data: { name: "Renamed option" },
      },
      { action: "create", field_id: f.type.id, data: { name: "Failure" } },
    ],
  };
  f.sqlite.exec(
    "CREATE TRIGGER fail_editor_insert BEFORE INSERT ON inventory_field_options BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
  );
  await f.api
    .patch(`/inventories/${f.inventory.id}/configuration`)
    .send(draft)
    .expect(500);
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.errors.length, 1);
  f.sqlite.exec("DROP TRIGGER fail_editor_insert");
  await f.api
    .patch(`/inventories/${f.inventory.id}/configuration`)
    .send(draft)
    .expect(200);
  assert.equal(f.services.inventories.get(f.inventory.id).name, "Updated");
  assert.equal(f.services.fields.list(f.inventory.id).length, 3);
});
