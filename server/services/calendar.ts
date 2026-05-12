import { config } from '../config';
import type { CalendarAttachment, CalendarEvent } from '../../shared/types';

const { calendarApi, bookingsCalendarId } = config;

const CALENDAR_REQUEST_TIMEOUT_MS = 25_000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = CALENDAR_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

type ListEventsOptions = {
  timeMin: string; // ISO datetime
  timeMax: string; // ISO datetime
  timeZone?: string;
};

type CreateOrUpdateEventData = {
  title?: string;
  description?: string;
  start?: string; // ISO datetime
  end?: string; // ISO datetime
  timeZone?: string;
  location?: string;
  patientId?: string;
  attachmentFileIds?: string[];
};

type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: {
    private?: Record<string, string>;
  };
  attachments?: Array<{
    fileId?: string;
    title?: string;
    fileUrl?: string;
    mimeType?: string;
  }>;
};

function normaliseGoogleEvent(item: GoogleCalendarEvent): CalendarEvent | null {
  if (item.status === 'cancelled') return null;

  const startIso =
    item.start?.dateTime ||
    (item.start?.date ? new Date(item.start.date).toISOString() : null);
  const endIso =
    item.end?.dateTime ||
    (item.end?.date ? new Date(item.end.date).toISOString() : null);

  if (!startIso || !endIso) return null;

  const extendedPrivate = item.extendedProperties?.private ?? {};
  const patientId = extendedPrivate.patientId;

  let attachments: CalendarAttachment[] | undefined;
  if (item.attachments && item.attachments.length > 0) {
    attachments = item.attachments
      .filter((a) => a.fileId)
      .map((a) => ({
        fileId: a.fileId as string,
        name: a.title,
        url: a.fileUrl,
        mimeType: a.mimeType,
      }));
  }

  return {
    id: item.id,
    calendarId: bookingsCalendarId,
    start: startIso,
    end: endIso,
    title: item.summary || '(No title)',
    description: item.description || '',
    location: item.location || '',
    patientId,
    attachments,
    extendedProps: extendedPrivate,
  };
}

// Exposed for lightweight unit tests
export const __test__normaliseGoogleEvent = normaliseGoogleEvent;

/**
 * List events from the configured bookings calendar over an arbitrary time range.
 */
export async function listEvents(
  token: string,
  { timeMin, timeMax, timeZone }: ListEventsOptions
): Promise<CalendarEvent[]> {
  if (!bookingsCalendarId) return [];

  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
    });
    if (timeZone) params.set('timeZone', timeZone);
    if (pageToken) params.set('pageToken', pageToken);

    const url = `${calendarApi}/calendars/${encodeURIComponent(
      bookingsCalendarId
    )}/events?${params.toString()}`;

    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
      CALENDAR_REQUEST_TIMEOUT_MS
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `[Calendar ${res.status}] Failed to fetch events: ${
          text || res.statusText
        }`
      );
    }

    const data = (await res.json()) as {
      items?: GoogleCalendarEvent[];
      nextPageToken?: string;
    };

    for (const item of data.items || []) {
      const mapped = normaliseGoogleEvent(item);
      if (mapped) events.push(mapped);
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return events;
}

/**
 * List today's events from the configured bookings calendar.
 * Kept for backwards compatibility with the existing sidebar.
 */
export async function listTodayEvents(token: string): Promise<CalendarEvent[]> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  return listEvents(token, {
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
  });
}

function buildEventBody(data: CreateOrUpdateEventData) {
  const body: any = {};

  if (data.title !== undefined) {
    body.summary = data.title;
  }
  if (data.description !== undefined) {
    body.description = data.description;
  }
  if (data.location !== undefined) {
    body.location = data.location;
  }
  if (data.start) {
    body.start = {
      dateTime: data.start,
      ...(data.timeZone ? { timeZone: data.timeZone } : {}),
    };
  }
  if (data.end) {
    body.end = {
      dateTime: data.end,
      ...(data.timeZone ? { timeZone: data.timeZone } : {}),
    };
  }

  const extendedPrivate: Record<string, string> = {};
  if (data.patientId) {
    extendedPrivate.patientId = data.patientId;
  }
  if (data.attachmentFileIds && data.attachmentFileIds.length > 0) {
    extendedPrivate.haloAttachmentFileIds = data.attachmentFileIds.join(',');
  }
  if (Object.keys(extendedPrivate).length > 0) {
    body.extendedProperties = {
      private: extendedPrivate,
    };
  }

  if (data.attachmentFileIds && data.attachmentFileIds.length > 0) {
    body.attachments = data.attachmentFileIds.map((fileId) => ({
      fileId,
    }));
  }

  return body;
}

export async function createEvent(
  token: string,
  data: Required<Pick<CreateOrUpdateEventData, 'title' | 'start' | 'end'>> &
    Omit<CreateOrUpdateEventData, 'title' | 'start' | 'end'>
): Promise<CalendarEvent> {
  if (!bookingsCalendarId) {
    throw new Error('Bookings calendar is not configured.');
  }

  const url = `${calendarApi}/calendars/${encodeURIComponent(
    bookingsCalendarId
  )}/events?supportsAttachments=true`;

  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildEventBody(data)),
    },
    CALENDAR_REQUEST_TIMEOUT_MS
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[Calendar ${res.status}] Failed to create event: ${
        text || res.statusText
      }`
    );
  }

  const created = (await res.json()) as GoogleCalendarEvent;
  const mapped = normaliseGoogleEvent(created);
  if (!mapped) {
    throw new Error('Created event is missing start or end time.');
  }
  return mapped;
}

export async function updateEvent(
  token: string,
  eventId: string,
  data: CreateOrUpdateEventData
): Promise<CalendarEvent> {
  if (!bookingsCalendarId) {
    throw new Error('Bookings calendar is not configured.');
  }

  const url = `${calendarApi}/calendars/${encodeURIComponent(
    bookingsCalendarId
  )}/events/${encodeURIComponent(eventId)}?supportsAttachments=true`;

  const res = await fetchWithTimeout(
    url,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildEventBody(data)),
    },
    CALENDAR_REQUEST_TIMEOUT_MS
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[Calendar ${res.status}] Failed to update event: ${
        text || res.statusText
      }`
    );
  }

  const updated = (await res.json()) as GoogleCalendarEvent;
  const mapped = normaliseGoogleEvent(updated);
  if (!mapped) {
    throw new Error('Updated event is missing start or end time.');
  }
  return mapped;
}

export async function deleteEvent(
  token: string,
  eventId: string
): Promise<void> {
  if (!bookingsCalendarId) {
    throw new Error('Bookings calendar is not configured.');
  }

  const url = `${calendarApi}/calendars/${encodeURIComponent(
    bookingsCalendarId
  )}/events/${encodeURIComponent(eventId)}`;

  const res = await fetchWithTimeout(
    url,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
    CALENDAR_REQUEST_TIMEOUT_MS
  );

  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[Calendar ${res.status}] Failed to delete event: ${
        text || res.statusText
      }`
    );
  }
}

export async function getEventById(
  token: string,
  eventId: string
): Promise<CalendarEvent | null> {
  if (!bookingsCalendarId) {
    throw new Error('Bookings calendar is not configured.');
  }

  const params = new URLSearchParams({
    // Ensures attachments are returned when present
    maxResults: '1',
  });

  const url = `${calendarApi}/calendars/${encodeURIComponent(
    bookingsCalendarId
  )}/events/${encodeURIComponent(eventId)}?${params.toString()}`;

  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
    CALENDAR_REQUEST_TIMEOUT_MS
  );

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[Calendar ${res.status}] Failed to fetch event: ${
        text || res.statusText
      }`
    );
  }

  const event = (await res.json()) as GoogleCalendarEvent;
  const mapped = normaliseGoogleEvent(event);
  return mapped;
}

export async function updateEventAttachments(
  token: string,
  eventId: string,
  attachmentFileIds: string[]
): Promise<CalendarEvent> {
  return updateEvent(token, eventId, { attachmentFileIds });
}

