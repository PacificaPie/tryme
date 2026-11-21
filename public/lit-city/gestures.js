// Pointer gestures are separate from the renderer so a drag/cancel can never
// become a work activation. Native pointer capture also covers release outside.
export function attachCityGestures(canvas, {onHover, onTap, onDrag, onStart, onEnd}) {
  let active = null;
  const pointers = new Set(), listeners = [];
  const listen = (type, handler) => { canvas.addEventListener(type, handler); listeners.push(() => canvas.removeEventListener(type, handler)); };
  function cancel() {
    const previous = active; active = null;
    if (previous && canvas.hasPointerCapture?.(previous.id)) canvas.releasePointerCapture(previous.id);
    canvas.classList.remove('dragging');
    if (previous) onEnd?.();
  }
  listen('pointerdown', event => {
    if (event.button !== 0) return;
    pointers.add(event.pointerId);
    if (pointers.size > 1 || event.isPrimary === false) { cancel(); return; }
    active = {id:event.pointerId, x:event.clientX, y:event.clientY, startX:event.clientX, startY:event.clientY, dragged:false, interrupted:onStart?.(event) === true};
    canvas.setPointerCapture?.(event.pointerId);
  });
  listen('pointermove', event => {
    if (!active) { if (!pointers.size && event.pointerType === 'mouse') onHover(event); return; }
    if (event.pointerId !== active.id) return;
    const dx = event.clientX - active.x, dy = event.clientY - active.y;
    if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) >= 6) active.dragged = true;
    if (active.dragged) { canvas.classList.add('dragging'); onDrag(dx, dy); }
    active.x = event.clientX; active.y = event.clientY;
  });
  listen('pointerup', event => {
    pointers.delete(event.pointerId);
    if (event.pointerId !== active?.id) return;
    const tap = !active.dragged && !active.interrupted;
    cancel();
    if (tap) onTap(event);
  });
  listen('pointercancel', event => { pointers.delete(event.pointerId); cancel(); });
  listen('lostpointercapture', event => { pointers.delete(event.pointerId); if (event.pointerId === active?.id) cancel(); });
  listen('pointerleave', () => { if (!active && !pointers.size) onHover(null); });
  return {cancel() { cancel(); pointers.clear(); }, dispose() { cancel(); pointers.clear(); listeners.forEach(off => off()); }};
}
