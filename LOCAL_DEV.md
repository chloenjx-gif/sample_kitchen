# Run Kitchen Planner on this computer

1. Open a terminal in this project folder and run `pnpm dev:local`. Leave the terminal open while using the app. The first run prepares a private local PostgreSQL database, applies the schema, and seeds the three reference datasets. Later runs reuse the saved database.
2. Open <http://127.0.0.1:3000> in a browser. To sign in, open the project-root `.env` file locally and use the value of `IMPORT_ADMIN_PASSWORD`. Keep that file private; do not paste its contents into chat or screenshots.
3. The supplied classroom files are in `operating-data/`. Import in this order: `current_inventory.json`, `HR_Staff_Master_2026-11.json`, `HR_Leave_2026-11.json`, `HR_Part_Time_Availability_2026-11.json`, then `CRM_Weekly_Sales_Orders_2026-10-28.csv`.
4. Reload the page and sign in again if needed. Each card shows the saved source, row count and import time. Re-importing the same file reports that it is a duplicate and leaves the saved rows unchanged.
5. Stop the terminal with Ctrl+C when finished. The PostgreSQL data remains in the ignored `.local-postgres/` folder and is reused on the next start.

The local import app works without an OpenAI API key. Agent planning is a later build step. The private `.env` file and `.local-postgres/` are excluded from Git.

The deterministic plan is available to a signed-in user at `http://127.0.0.1:3000/api/plan` as structured JSON. The full visual dashboard is a later build step.
