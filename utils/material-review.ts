export interface MaterialReviewItem {
  index: number;
  required: boolean;
  filled: boolean;
  fileRecordId?: number;
}

export interface MaterialReviewState {
  materialMode: boolean;
  missingRequired: number;
  unpreviewed: number;
  canConfirm: boolean;
}

export function computeMaterialReviewState(
  items: MaterialReviewItem[],
  previewedFileByField: ReadonlyMap<number, number>,
  previewedExistingFields: ReadonlySet<number>,
  reviewPaused: boolean,
): MaterialReviewState {
  const missingRequired = items.filter((item) => item.required && !item.filled).length;
  const unpreviewed = items.filter((item) => {
    if (!item.filled) return false;
    if (item.fileRecordId != null) return previewedFileByField.get(item.index) !== item.fileRecordId;
    return !previewedExistingFields.has(item.index);
  }).length;
  return {
    materialMode: items.length > 0,
    missingRequired,
    unpreviewed,
    canConfirm: reviewPaused && missingRequired === 0 && unpreviewed === 0,
  };
}
