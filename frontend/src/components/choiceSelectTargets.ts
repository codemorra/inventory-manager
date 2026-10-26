/**
 * Treat a portalled choice list as part of the control or panel that owns it.
 * @param root The control or containing panel handling an outside interaction.
 * @param target The pointer, focus, or scroll target, possibly inside a choice portal.
 * @returns Whether the target belongs to this root or one of its choice lists.
 */
export function containsChoiceTarget(
  root: HTMLElement | null,
  target: EventTarget | null,
): boolean {
  if (!root || !(target instanceof Node)) return false;
  if (root.contains(target)) return true;
  const element = target instanceof Element ? target : target.parentElement;
  const ownerId = element?.closest<HTMLElement>("[data-choice-owner]")?.dataset
    .choiceOwner;
  const owner = ownerId ? document.getElementById(ownerId) : null;
  return owner !== null && root.contains(owner);
}
