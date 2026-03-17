const shanghaiDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function normalizeFormattedDateTime(value: string) {
  return value.replace(/\//g, '-');
}

export function isUtcTimestampString(value: string) {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && /(Z|[+-]\d{2}:\d{2})$/.test(value);
}

export function formatTimeToShanghai(value?: string | null) {
  if (!value) return '-';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return normalizeFormattedDateTime(shanghaiDateTimeFormatter.format(date));
}

export function formatDatabaseCellValue(value: unknown, dataType?: string) {
  if (value === null || value === undefined) return 'NULL';

  if (typeof value === 'string') {
    if (dataType?.includes('timestamp') || isUtcTimestampString(value)) {
      return formatTimeToShanghai(value);
    }

    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
