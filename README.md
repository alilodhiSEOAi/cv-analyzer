# Ali Lodhi | SEO & AI Automation – CV Analyzer

Stack: HTML/CSS/JS frontend (public/) + Netlify Function (netlify/functions/api.js) + MySQL (TiDB Cloud) + Gemini API.

## Deploy in 5 steps
1. Database: create a free TiDB Cloud Starter cluster (MySQL-compatible). Click Connect and copy host, port, user, password. Database name: test. The table is created automatically on first request.
2. Gemini key: https://aistudio.google.com/apikey > Create API key.
3. GitHub: create a new repository and upload the contents of this folder (never upload .env or node_modules).
4. Netlify: Add new site > Import an existing project > GitHub > choose the repo. Build command empty. Publish directory: public. Deploy.
5. Netlify > Site configuration > Environment variables, add:
   GEMINI_API_KEY, GEMINI_MODEL=gemini-2.5-flash, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, ADMIN_KEY (your own long password).
   Then Deploys > Trigger deploy > Clear cache and deploy site.

Contact on the site: alilodhiseo@gmail.com
