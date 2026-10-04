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

export function resizeCallRect(rect, bounds, edge, dx, dy) {
    const minimum = clampCallRect({ width: 1, height: 1 }, bounds);
    const maximum = clampCallRect({ width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER }, bounds);
    const next = { ...rect }, right = rect.x + rect.width, bottom = rect.y + rect.height;
    if (edge.includes('left')) {
        next.width = Math.min(maximum.width, right - 8, Math.max(minimum.width, rect.width - dx));
        next.x = right - next.width;
    } else if (edge.includes('right')) next.width = Math.min(maximum.width, bounds.width - rect.x - 8, Math.max(minimum.width, rect.width + dx));
    if (edge.includes('top')) {
        next.height = Math.min(maximum.height, bottom - 8, Math.max(minimum.height, rect.height - dy));
        next.y = bottom - next.height;
    } else if (edge.includes('bottom')) next.height = Math.min(maximum.height, bounds.height - rect.y - 8, Math.max(minimum.height, rect.height + dy));
    return clampCallRect(next, bounds);
}
