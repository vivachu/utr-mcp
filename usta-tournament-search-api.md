# USTA Tournament Search API — Reverse-Engineered Spec

Discovered via browser network inspection of `playtennis.usta.com`, April 2026.

---

## Primary Search Endpoint

```
POST https://prd-usta-kube.clubspark.pro/unified-search-api/api/Search/tournaments/Query?indexSchema=tournament
Content-Type: application/json
```

The USTA tournament search page (`playtennis.usta.com/tournaments`) is built on
**ClubSpark's unified search service** (`prd-usta-kube.clubspark.pro`). CORS is open
from within the playtennis.usta.com origin.

---

## Request Body (partial — filter schema still being resolved)

```json
{
  "take": 20,
  "skip": 0,
  "sort": "date",
  "location": {
    "lat": 41.0534,
    "lng": -73.6287,
    "radiusMiles": 25
  },
  "dateRange": {
    "from": "2026-04-29T00:00:00Z",
    "to":   "2026-07-31T23:59:59Z"
  }
}
```

### Known working fields
| Field | Type | Notes |
|---|---|---|
| `take` | int | page size |
| `skip` | int | offset for pagination |
| `sort` | string | `"date"` |
| `location.lat` | float | decimal degrees |
| `location.lng` | float | decimal degrees |
| `location.radiusMiles` | int | search radius |
| `dateRange.from` | ISO8601 string | start date |
| `dateRange.to` | ISO8601 string | end date |

### Filter schema (partially reverse-engineered)
The `filters` object uses ClubSpark's `List<Filter>` model. Raw string arrays fail.
Exact structure still being determined. The URL parameter equivalents are:

| URL param | Meaning |
|---|---|
| `tournament-level[,]=00000000-0000-0000-0000-000000000006` | Level 6 |
| `tournament-level[,]=00000000-0000-0000-0000-000000000007` | Level 7 |
| `event-division-gender[,]=boys` | Boys |
| `event-division-age-category[,]=12U` | 12U age group |

**Working URL with all filters applied (use as fallback if POST filters can't be constructed):**
```
https://playtennis.usta.com/tournaments
  ?level-category=junior
  &location=Greenwich,%20CT
  &distance=100
  &tournament-level[,]=00000000-0000-0000-0000-000000000006,00000000-0000-0000-0000-000000000007
  &event-division-gender[,]=boys
  &event-division-age-category[,]=12U
  &date-range[]=2026-04-29T00:00:00.000Z
  &date-range[]=2026-07-31T23:59:59.000Z
```

---

## Tournament Detail URL Pattern

```
https://playtennis.usta.com/Competitions/{org-slug}/Tournaments/Overview/{guid}
```

- `org-slug` is the ClubSpark organization slug (lowercase, hyphen-separated)
- `guid` is the tournament UUID (lowercase)

**Example:**
```
https://playtennis.usta.com/Competitions/westchestertenniscenter/Tournaments/Overview/0db0271e-a3e9-4350-a4de-78ee6edad842
```

---

## Known Tournament GUIDs (Boys 12U L6/L7, within 20mi of Greenwich CT, May–Jul 2026)

### Already registered (Cole)
| Tournament | Date | GUID |
|---|---|---|
| L6 Championships @ Masters School | Sun May 3 | `fa2bee79-42cf-49e0-8d1e-1e8154aad9b8` |
| L6 Championships @ Masters School | Sun May 17 | `21c7c2a3-9d35-4546-a4f5-44037e6a58c5` |

### Open / upcoming (with open registration)
| Tournament | Date | GUID | Dist |
|---|---|---|---|
| L7 SPORTIME Lake Isle May Championships | Sat–Sun May 2–3 | `f3f8cd73-c646-4b08-aec9-6b021012edc4` | 6mi |
| L6 WTC B/G 12,14 (singles & doubles) | Sat–Sun May 2–3 | `0db0271e-a3e9-4350-a4de-78ee6edad842` | 6mi |
| L7 WTC B/G 12U,14U,16U (singles & doubles) | Fri–Sun May 8–10 | `731fe4ed-89d7-4878-8be2-6d2a73fa0b45` | 3mi |
| L6 UnitedSets Greenwich BG U12–U18 | Fri–Sun May 1–3 | `facacf69-b26a-444f-9077-8338bdb7b14e` | 14mi |
| L6 Southern CT 12,18/14,16 Round Robin | Sat–Sun May 2–3 | `dcdaf1da-dcd5-44cd-a861-86130497cb7d` | 43mi |

---

## Response Shape (partial)
The 200 response is JSON with `results` array, each containing:
- `id` (tournament GUID)
- `name`
- `startDate` / `endDate`
- `location` (address + lat/lng)
- `distance` (miles from search point)
- `registrationStatus`
- `tournamentLevel`
- `url` (relative path on playtennis.usta.com)

---

## Integration Notes for UTR MCP

To add this as a `search_usta_tournaments` tool that bypasses the browser:

1. **HTTP client**: Standard POST, no auth required for public search
2. **Geo-coordinates for Greenwich CT**: `lat=41.0534, lng=-73.6287`
3. **Rate limiting**: Unknown — ClubSpark CDN-fronted, should be permissive for read
4. **Pagination**: Use `skip` + `take` to page through 240+ results
5. **Filter workaround**: POST without filters, then filter results client-side by level/gender/age from the response fields — simpler than resolving the Filter schema
6. **Tournament page links**: Construct from `https://playtennis.usta.com/Competitions/{response.organizationSlug}/Tournaments/Overview/{response.id}`

---

## Open Questions
- Exact ClubSpark `Filter` model schema (needs further probing or ClubSpark API docs)
- Whether an API key is needed for non-browser contexts (currently works via CORS from USTA origin)
- `organizationSlug` field name in response payload (need a successful 200 response to inspect)
