export function clampCallRect(rect, bounds, narrow = bounds.width < 600 || (bounds.width < 1180 && bounds.height < 500)) {
    const margin = 8, availableWidth = Math.max(1, bounds.width - margin * 2), availableHeight = Math.max(1, bounds.height - margin * 2);
    const maxWidth = narrow ? Math.min(availableWidth, 360, Math.max(160, bounds.width * .55)) : availableWidth;
    const maxHeight = narrow ? Math.min(availableHeight, 240, bounds.height * .55) : availableHeight;
    const minWidth = Math.min(narrow ? 150 : 260, maxWidth), minHeight = Math.min(narrow ? 160 : 180, maxHeight);
    const width = Math.min(maxWidth, Math.max(minWidth, Number(rect?.width) || 360));
    const height = Math.min(maxHeight, Math.max(minHeight, Number(rect?.height) || 240));
    const x = Math.max(margin, Math.min(bounds.width - width - margin, Number.isFinite(rect?.x) ? rect.x : bounds.width - width - 16));
    const y = Math.max(margin, Math.min(bounds.height - height - margin, Number.isFinite(rect?.y) ? rect.y : bounds.height - height - 16));
    return { x, y, width, height };
}
