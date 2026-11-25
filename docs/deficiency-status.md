# Updating a deficiency status from Salesforce

When a user changes the status of a deficiency in Salesforce, call this endpoint and ZenFire will show the same status.

**Endpoint:** `POST https://salesforce.zentrades.pro/api/deficiencies/status`
**Headers:** `Content-Type: application/json` and `x-api-key: <your key>` (the same key as the other calls)

## Request

```json
{
  "incidentId": "5XFeHeZCzM",
  "ticketId": 1936539,
  "status": "Rejected"
}
```

| Field | Required | Notes |
|---|---|---|
| `incidentId` | yes | The ZenFire deficiency id. It is sent to you in every incident of the deficiency report (`incidentId`). Store it with the incident in Salesforce. |
| `status` | yes | The new status. Spelling matches ZenFire; capitalization does not matter (`rejected` works). Allowed today: **Open**, **Rejected**, **Resolved**. More can be added on request. |
| `ticketId` | no, recommended | The ZenFire ticket id. When it is sent, the deficiency is first looked up on that ticket: an id from another ticket is refused, and the answer includes the previous status. |

## Answers

`status` tells you whether the call worked (`success` or `error`). `deficiencyStatus` is the deficiency's status.

Success, **HTTP 200**:

```json
{
  "status": "success",
  "action": "updated",
  "incidentId": "5XFeHeZCzM",
  "ticketId": "1936539",
  "deficiencyStatus": "Rejected",
  "previousStatus": "Open",
  "message": "Deficiency status set to Rejected.",
  "warnings": []
}
```

If the deficiency already has that status (and `ticketId` was sent), `"action"` is `"unchanged"` and nothing is written. Sending the same request twice is safe.

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | A field is missing, or the status is not allowed. `allowedStatuses` lists the allowed values. |
| 401 | `UNAUTHORIZED` | Missing or wrong `x-api-key`. |
| 404 | `NOT_FOUND` | No deficiency with that id (or it is not on the ticket given). |
| 502 | `ZENFIRE_ERROR` | ZenFire refused the change. `detail` says why. |

## Notes
- Send one of the allowed statuses only: what you send is what ZenFire stores.
- After a change, the next deficiency report for that ticket carries the new status. Salesforce should treat that as no change.
- Please check that your report endpoint accepts the extra `incidentId` field on each incident.
