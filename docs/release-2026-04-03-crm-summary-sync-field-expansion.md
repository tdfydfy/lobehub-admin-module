# 2026-04-03 CRM Summary Sync Field Expansion

## Summary

This release expands the lightweight CRM summary sync so the assistant can persist richer customer profile fields with minimal system intrusion.

## Shipped Changes

- Added structured CRM sync fields on top of the existing lightweight message-driven flow:
  - `gender`
  - `age`
  - `family_structure`
  - `living_area`
  - `desired_layout`
  - `target_unit_price`
  - `target_total_price`
  - `first_visit_time`
  - `intent_grade`
  - `current_stage`
  - `summary`
- Upgraded the structured payload contract from `crm_customer_summary.v1` to `crm_customer_summary.v2`.
- Kept backward compatibility for existing `v1` messages already produced in chat history.
- Standardized intent grading to `A / B / C / D / null`.
- Added backend gender fallback inference from customer titles such as `先生` / `女士` / `太太` / `小姐` when the model leaves `gender` empty.
- Kept follow-up advice chat-only and out of CRM storage.
- Raised the customer summary body limit from 200 to 300 Chinese characters.

## Docs Updated

- Unified rule source:
  - [docs/customer-discuss-rules-unified.md](/D:/claudecodefiles/lobehub-admin-module/docs/customer-discuss-rules-unified.md)
- Rollout notes:
  - [docs/crm-summary-sync-rollout.md](/D:/claudecodefiles/lobehub-admin-module/docs/crm-summary-sync-rollout.md)

## Deployment Status

- `ali-temp` was used for verification and hotfix iteration first.
- `ali-2c2g` was synced after verification passed.
- The shared global document `customer-discuss-rules` was updated to the new `v2` template.

## Verification

- Controlled smoke tests confirmed:
  - message status changed from `未保存` to `已保存`
  - CRM rows were created or updated correctly
  - newly added fields were persisted
  - gender fallback inference worked for names like `王先生`
