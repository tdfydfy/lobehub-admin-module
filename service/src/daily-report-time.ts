type LocalDateParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();
const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getDateTimeFormatter(timeZone: string) {
  const cacheKey = timeZone;
  const existing = dateTimeFormatterCache.get(cacheKey);

  if (existing) {
    return existing;
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  dateTimeFormatterCache.set(cacheKey, formatter);
  return formatter;
}

function getOffsetFormatter(timeZone: string) {
  const cacheKey = timeZone;
  const existing = offsetFormatterCache.get(cacheKey);

  if (existing) {
    return existing;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  });

  offsetFormatterCache.set(cacheKey, formatter);
  return formatter;
}

function parseOffsetMinutes(offsetText: string) {
  if (offsetText === 'GMT' || offsetText === 'UTC') {
    return 0;
  }

  const match = offsetText.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);

  if (!match) {
    throw new Error(`Unsupported time zone offset text: ${offsetText}`);
  }

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? '0');
  return sign * (hours * 60 + minutes);
}

function getOffsetMinutes(date: Date, timeZone: string) {
  const formatter = getOffsetFormatter(timeZone);
  const offsetText = formatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value;

  if (!offsetText) {
    throw new Error(`Failed to resolve time zone offset for ${timeZone}`);
  }

  return parseOffsetMinutes(offsetText);
}

export function normalizeTimeString(value?: string | null) {
  const raw = (value ?? '').trim();

  if (!raw) {
    return '22:00:00';
  }

  const match = raw.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);

  if (!match) {
    throw new Error(`Invalid local time string: ${value}`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? '00');

  if (hours > 23 || minutes > 59 || seconds > 59) {
    throw new Error(`Invalid local time string: ${value}`);
  }

  return `${match[1]}:${match[2]}:${match[3] ?? '00'}`;
}

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function addDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));

  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function getLocalDateTimeParts(date: Date, timeZone: string): LocalDateParts {
  const formatter = getDateTimeFormatter(timeZone);
  const parts = formatter.formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  const second = parts.find((part) => part.type === 'second')?.value;

  if (!year || !month || !day || !hour || !minute || !second) {
    throw new Error(`Failed to resolve local time parts for ${timeZone}`);
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
  };
}

export function getLocalDateString(date: Date, timeZone: string) {
  const parts = getLocalDateTimeParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getLocalTimeString(date: Date, timeZone: string) {
  const parts = getLocalDateTimeParts(date, timeZone);
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

export function getLatestClosedBusinessDate(now: Date, timeZone: string, closeTimeLocal: string) {
  const normalizedCloseTime = normalizeTimeString(closeTimeLocal);
  const localDate = getLocalDateString(now, timeZone);
  const localTime = getLocalTimeString(now, timeZone);

  if (localTime >= normalizedCloseTime) {
    return localDate;
  }

  return addDays(localDate, -1);
}

export function zonedLocalDateTimeToUtc(dateString: string, timeString: string, timeZone: string) {
  const normalizedTime = normalizeTimeString(timeString);
  const [year, month, day] = dateString.split('-').map(Number);
  const [hour, minute, second] = normalizedTime.split(':').map(Number);

  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offsetMinutes = getOffsetMinutes(guess, timeZone);
    const resolved = new Date(Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000);

    if (resolved.getTime() === guess.getTime()) {
      return resolved;
    }

    guess = resolved;
  }

  return guess;
}

export function resolveBusinessWindow(
  businessDate: string,
  timeZone: string,
  closeTimeLocal: string,
) {
  const normalizedCloseTime = normalizeTimeString(closeTimeLocal);
  const windowStart = zonedLocalDateTimeToUtc(businessDate, '00:00:00', timeZone);
  const windowEnd = zonedLocalDateTimeToUtc(businessDate, normalizedCloseTime, timeZone);

  return {
    businessDate,
    timeZone,
    closeTimeLocal: normalizedCloseTime,
    startAt: windowStart.toISOString(),
    endAt: windowEnd.toISOString(),
  };
}
