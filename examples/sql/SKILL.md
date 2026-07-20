---
name: sql
description: Write a SQL query against our analytics warehouse (the ad-serving star schema on Trino/Athena) from a plain-language ask. Use when someone wants a query, a metric pulled, or numbers aggregated "from the warehouse". Not for explaining SQL syntax in the abstract, tuning a generic database, or reviewing a schema-migration diff.
---

# sql — query our analytics warehouse

Turn a plain-language ask ("last week's revenue by campaign") into one runnable
query against **our** warehouse. The value is the schema and its gotchas — base
knowledge of SQL is assumed; knowledge of *these tables* is not.

## Engine

Trino / Athena SQL. Use `date_trunc`, `date_add('day', -N, current_date)`,
`approx_distinct`, and standard `JOIN … ON`. String dates are ISO (`'2026-07-13'`).

## Schema (star schema — one fact, dimensions hang off it)

`fact_impression` — grain: one row per served impression.

| column           | type      | notes                                                    |
| ---------------- | --------- | -------------------------------------------------------- |
| `dt`             | DATE      | **partition key — always filter on it**, else full scan |
| `served_at`      | TIMESTAMP | event time                                               |
| `campaign_id`    | BIGINT    | → `dim_campaign.campaign_id`                             |
| `revenue_micros` | BIGINT    | revenue in **micro-USD** — divide by `1e6` for dollars   |

`dim_campaign`

| column          | type    | notes                             |
| --------------- | ------- | --------------------------------- |
| `campaign_id`   | BIGINT  | primary key                       |
| `campaign_name` | VARCHAR |                                   |
| `advertiser_id` | BIGINT  | → `dim_advertiser.advertiser_id`  |

`dim_advertiser`

| column            | type    |
| ----------------- | ------- |
| `advertiser_id`   | BIGINT  |
| `advertiser_name` | VARCHAR |

## Rules — the three that base SQL knowledge gets wrong here

1. **Money is micros.** `revenue_micros` is micro-USD stored as BIGINT. Report
   dollars as `sum(revenue_micros) / 1e6 AS revenue_usd` — never the raw column.
2. **Always filter the `dt` partition.** Every query bounds `dt` in the WHERE
   clause (`dt >= date_add('day', -7, current_date)`); an unpartitioned scan is
   a mistake, not a style choice.
3. **The fact table is `fact_impression` (singular), joined on `campaign_id`.**
   There is no `impressions`, `revenue`, or `campaigns` table — use these names.

Prefer explicit column lists over `SELECT *`. Alias aggregates (`revenue_usd`,
`impressions`). One statement, ready to paste.

## Examples

Last week's revenue by campaign:

```sql
SELECT c.campaign_name,
       sum(f.revenue_micros) / 1e6 AS revenue_usd
FROM fact_impression f
JOIN dim_campaign c ON c.campaign_id = f.campaign_id
WHERE f.dt >= date_add('day', -7, current_date)
GROUP BY c.campaign_name
ORDER BY revenue_usd DESC;
```

Top 10 advertisers by spend this month:

```sql
SELECT a.advertiser_name,
       sum(f.revenue_micros) / 1e6 AS revenue_usd
FROM fact_impression f
JOIN dim_campaign   c ON c.campaign_id   = f.campaign_id
JOIN dim_advertiser a ON a.advertiser_id = c.advertiser_id
WHERE f.dt >= date_trunc('month', current_date)
GROUP BY a.advertiser_name
ORDER BY revenue_usd DESC
LIMIT 10;
```
