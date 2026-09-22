// Push backfilled completed_date values into Monday.com's own "date__1" column.
//
// Context: 79 locked projects on boards 8873009477 and 7236438251 had a completed_date
// in Supabase (backfilled from Monday's own status.value.changed_at) but the mapped
// Monday date column (date__1) was empty. This writes those 79 dates back to Monday so
// the two stay in sync and the source-of-truth board reflects reality.
//
// Run from the repo root: node scripts/backfill-monday-completed-dates.mjs
// Add --dry-run to preview the mutations without sending them.
//
// Requires MONDAY_API_TOKEN in .env.local (same variable the app already uses).

import fs from 'node:fs'
import path from 'node:path'

const DRY_RUN = process.argv.includes('--dry-run')
const DATE_COLUMN_ID = 'date__1'

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local not found in the current directory. Run this from the repo root.')
  }
  const content = fs.readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvLocal()

const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN
if (!MONDAY_API_TOKEN) {
  throw new Error('MONDAY_API_TOKEN not found in .env.local')
}

async function mondayRequest(query, variables) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: MONDAY_API_TOKEN,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors))
  }
  return json.data
}

const MUTATION = `
  mutation ($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
    change_column_value(item_id: $itemId, board_id: $boardId, column_id: $columnId, value: $value) {
      id
    }
  }
`

const ROWS = [
  { "itemId": "6278102622", "boardId": "7236438251", "date": "2024-08-15", "name": "Adobe express Social Templates" },
  { "itemId": "6349744675", "boardId": "7236438251", "date": "2024-08-15", "name": "Rugged Data - File Transfers" },
  { "itemId": "10645801157", "boardId": "8873009477", "date": "2026-01-23", "name": "KP Master Brand Site" },
  { "itemId": "10652036128", "boardId": "8873009477", "date": "2025-12-12", "name": "KP Guest Details Questionnaire" },
  { "itemId": "10657430915", "boardId": "8873009477", "date": "2026-01-05", "name": "Salo UI Video" },
  { "itemId": "10690777869", "boardId": "8873009477", "date": "2026-04-02", "name": "Provenant Feb Hangover" },
  { "itemId": "10701129772", "boardId": "8873009477", "date": "2026-01-21", "name": "Complete Website - 1 homepage" },
  { "itemId": "10701138529", "boardId": "8873009477", "date": "2025-12-17", "name": "Skylight" },
  { "itemId": "10701424314", "boardId": "8873009477", "date": "2025-12-17", "name": "UX Audit - Queens College" },
  { "itemId": "10701466571", "boardId": "8873009477", "date": "2026-02-23", "name": "Inn-Track - Website Updates" },
  { "itemId": "10733395847", "boardId": "8873009477", "date": "2025-12-17", "name": "CRO Audit" },
  { "itemId": "10786504748", "boardId": "8873009477", "date": "2026-03-18", "name": "3C Website" },
  { "itemId": "10788954162", "boardId": "8873009477", "date": "2026-01-09", "name": "Genesis email update" },
  { "itemId": "10934710414", "boardId": "8873009477", "date": "2026-01-22", "name": "Capco AI Maturity Assessment" },
  { "itemId": "10936705771", "boardId": "8873009477", "date": "2026-01-20", "name": "DBT Trade Mission Advert" },
  { "itemId": "10956070771", "boardId": "8873009477", "date": "2026-01-20", "name": "DBT Trade Mission Video" },
  { "itemId": "10973978824", "boardId": "8873009477", "date": "2026-01-13", "name": "Apple Juice Labels" },
  { "itemId": "10973981016", "boardId": "8873009477", "date": "2026-01-12", "name": "2025 Wrapped Presentation" },
  { "itemId": "11046694982", "boardId": "8873009477", "date": "2026-01-20", "name": "Gemma's Performance Review Process Presentation" },
  { "itemId": "11057941976", "boardId": "8873009477", "date": "2026-03-27", "name": "KP / TEG Currency Conversion" },
  { "itemId": "11080069591", "boardId": "8873009477", "date": "2026-01-26", "name": "Linked in Post - New Joiners" },
  { "itemId": "11095727351", "boardId": "8873009477", "date": "2026-02-05", "name": "3C New hires post template" },
  { "itemId": "11107083577", "boardId": "8873009477", "date": "2026-02-05", "name": "AI Maturity Tool amends" },
  { "itemId": "11118048414", "boardId": "8873009477", "date": "2026-02-05", "name": "3C Margin Pro" },
  { "itemId": "11129707639", "boardId": "8873009477", "date": "2026-01-29", "name": "3C Onboarding Deck" },
  { "itemId": "11130934412", "boardId": "8873009477", "date": "2026-04-29", "name": "3C Hub UI/UX" },
  { "itemId": "11193946659", "boardId": "8873009477", "date": "2026-02-18", "name": "3C Poster Design" },
  { "itemId": "11222510611", "boardId": "8873009477", "date": "2026-02-17", "name": "KP Child ticket update" },
  { "itemId": "11246469972", "boardId": "8873009477", "date": "2026-03-10", "name": "SXSW Landing Page" },
  { "itemId": "11246472641", "boardId": "8873009477", "date": "2026-02-27", "name": "Carl Business Cards" },
  { "itemId": "11258839671", "boardId": "8873009477", "date": "2026-03-18", "name": "Internship Assets" },
  { "itemId": "11259282008", "boardId": "8873009477", "date": "2026-02-13", "name": "Prosper Table Design Print" },
  { "itemId": "11313623482", "boardId": "8873009477", "date": "2026-03-02", "name": "Art-working Sticker Designs" },
  { "itemId": "11314832130", "boardId": "8873009477", "date": "2026-03-17", "name": "Design 291 + 294 Print Work" },
  { "itemId": "11341093838", "boardId": "8873009477", "date": "2026-03-31", "name": "KP Experience Builder Questionnaire" },
  { "itemId": "11360459614", "boardId": "8873009477", "date": "2026-05-05", "name": "3C Margin Pro" },
  { "itemId": "11373276600", "boardId": "8873009477", "date": "2026-02-27", "name": "Agency Grand Prix Website" },
  { "itemId": "11383973507", "boardId": "8873009477", "date": "2026-03-02", "name": "3C Convert Google Slides" },
  { "itemId": "11469190355", "boardId": "8873009477", "date": "2026-03-18", "name": "Josh's Accessibility Presentation" },
  { "itemId": "11527678897", "boardId": "8873009477", "date": "2026-04-01", "name": "3C Event Graphics" },
  { "itemId": "11534603431", "boardId": "8873009477", "date": "2026-03-27", "name": "AGP Graphics" },
  { "itemId": "11548316708", "boardId": "8873009477", "date": "2026-04-09", "name": "3C Employee Handbook" },
  { "itemId": "11579002866", "boardId": "8873009477", "date": "2026-05-05", "name": "Web page templates" },
  { "itemId": "11580145577", "boardId": "8873009477", "date": "2026-03-26", "name": "Print-ready support" },
  { "itemId": "11626695020", "boardId": "8873009477", "date": "2026-04-24", "name": "3C Interviewing at Threecolts Google Slides" },
  { "itemId": "11661168146", "boardId": "8873009477", "date": "2026-07-03", "name": "Simpson Travel Booking Journey Refinements" },
  { "itemId": "11661188058", "boardId": "8873009477", "date": "2026-04-24", "name": "Lyvera Blog" },
  { "itemId": "11687448525", "boardId": "8873009477", "date": "2026-04-24", "name": "Babble Asset Creation" },
  { "itemId": "11689549056", "boardId": "8873009477", "date": "2026-04-24", "name": "Teapot UX Audit" },
  { "itemId": "11743528939", "boardId": "8873009477", "date": "2026-04-16", "name": "3C Webinar LinkedIn" },
  { "itemId": "11743627304", "boardId": "8873009477", "date": "2026-04-21", "name": "3C Event Menu Card" },
  { "itemId": "11766753708", "boardId": "8873009477", "date": "2026-08-21", "name": "Modernise Design System for Platform" },
  { "itemId": "11766886701", "boardId": "8873009477", "date": "2026-07-29", "name": "New website" },
  { "itemId": "11804209092", "boardId": "8873009477", "date": "2026-05-28", "name": "Loyalty programme designs" },
  { "itemId": "11804778656", "boardId": "8873009477", "date": "2026-04-21", "name": "Carrier workshop" },
  { "itemId": "11805578996", "boardId": "8873009477", "date": "2026-04-24", "name": "3C Name Bages and Placecards" },
  { "itemId": "11866676746", "boardId": "8873009477", "date": "2026-05-08", "name": "3C Oboarding Brands Infographics" },
  { "itemId": "11889415555", "boardId": "8873009477", "date": "2026-05-08", "name": "AGP Socials - Salo Promo Vid" },
  { "itemId": "11975315310", "boardId": "8873009477", "date": "2026-05-28", "name": "Gift voucher flow" },
  { "itemId": "11998820427", "boardId": "8873009477", "date": "2026-05-22", "name": "Threecolts AI knowledge transfer" },
  { "itemId": "12010502654", "boardId": "8873009477", "date": "2026-06-01", "name": "UEL app concepts" },
  { "itemId": "12037030521", "boardId": "8873009477", "date": "2026-05-18", "name": "313 - 3C One-Pager for Retail 365 GA" },
  { "itemId": "12037389431", "boardId": "8873009477", "date": "2026-05-26", "name": "314 - Master slide deck templates" },
  { "itemId": "12128409905", "boardId": "8873009477", "date": "2026-07-08", "name": "UEL app phase 2" },
  { "itemId": "12138708786", "boardId": "8873009477", "date": "2026-06-24", "name": "CAMC Interactive Map" },
  { "itemId": "12156017141", "boardId": "8873009477", "date": "2026-06-19", "name": "Keith Prowse Account Navigation" },
  { "itemId": "12277224931", "boardId": "8873009477", "date": "2026-06-22", "name": "Home page concept" },
  { "itemId": "12299266735", "boardId": "8873009477", "date": "2026-06-19", "name": "Presentation Deck Improvements" },
  { "itemId": "12452573889", "boardId": "8873009477", "date": "2026-07-24", "name": "UEL app - Additional screens" },
  { "itemId": "12604413614", "boardId": "8873009477", "date": "2026-08-25", "name": "Purbeck Cider Glass and Christmas Gift Box Design" },
  { "itemId": "12671380288", "boardId": "8873009477", "date": "2026-09-03", "name": "KP new functionality onboarding tooltips" },
  { "itemId": "12771381634", "boardId": "8873009477", "date": "2026-08-21", "name": "Mowlem old website fix" },
  { "itemId": "12784065724", "boardId": "8873009477", "date": "2026-09-02", "name": "Birds of Poole Harbour - Discovery session setup" },
  { "itemId": "18332710242", "boardId": "8873009477", "date": "2026-01-14", "name": "TEG booking component update" },
  { "itemId": "18362504343", "boardId": "8873009477", "date": "2026-03-18", "name": "Salo New Website" },
  { "itemId": "18377771598", "boardId": "8873009477", "date": "2026-01-05", "name": "Threecolts Website 2025" },
  { "itemId": "8903237981", "boardId": "8873009477", "date": "2026-06-22", "name": "Logo & Label design" },
  { "itemId": "9458427484", "boardId": "8873009477", "date": "2026-01-14", "name": "Purbeck Cider website" },
  { "itemId": "9806490300", "boardId": "8873009477", "date": "2026-03-26", "name": "SRC Websites - 5 x Water Brands" }
]

async function main() {
  console.log(`Pushing completed_date to Monday for ${ROWS.length} items${DRY_RUN ? ' (dry run)' : ''}...`)

  let ok = 0
  let failed = 0

  for (const row of ROWS) {
    const value = JSON.stringify({ date: row.date })
    if (DRY_RUN) {
      console.log(`[dry-run] item ${row.itemId} (board ${row.boardId}, "${row.name}") -> ${row.date}`)
      ok++
      continue
    }
    try {
      await mondayRequest(MUTATION, {
        itemId: row.itemId,
        boardId: row.boardId,
        columnId: DATE_COLUMN_ID,
        value,
      })
      console.log(`OK   item ${row.itemId} (board ${row.boardId}, "${row.name}") -> ${row.date}`)
      ok++
    } catch (err) {
      console.error(`FAIL item ${row.itemId} (board ${row.boardId}, "${row.name}"): ${err.message}`)
      failed++
    }
    // Be polite to Monday's rate limits.
    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  console.log(`\nDone. ${ok} succeeded, ${failed} failed.`)
  if (failed > 0) process.exitCode = 1
}

main()
