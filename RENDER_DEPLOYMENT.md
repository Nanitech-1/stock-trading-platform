# Deploying Stock Trading Platform on Render.com

This guide provides step-by-step instructions to deploy the entire full-stack project (Backend, Frontend Landing, and Kite Dashboard) to **Render.com**.

---

## 📋 Architecture on Render

| Service | Render Type | Root Directory | Build Command | Start / Publish |
| :--- | :--- | :--- | :--- | :--- |
| **Backend API** | Web Service | `backend` | `npm install` | `npm start` |
| **Frontend Landing** | Static Site | `frontend` | `npm install && npm run build` | `build` |
| **Kite Dashboard** | Static Site | `dashboard` | `npm install && npm run build` | `build` |

---

## 🛠️ Step 1: Prepare MongoDB Atlas (Crucial for Cloud Deployment)

Render servers have dynamic IP addresses. For your backend to connect to MongoDB Atlas in production:

1. Log into [MongoDB Atlas](https://cloud.mongodb.com).
2. Go to **Network Access** in the left sidebar (under *Security*).
3. Click **+ Add IP Address**.
4. Click **Allow Access from Anywhere** (`0.0.0.0/0`).
5. Click **Confirm**.
6. Under **Database**, click **Connect** > **Drivers** (Node.js) and copy your connection string:
   ```text
   mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<database>?retryWrites=true&w=majority
   ```

---

## 🚀 Step 2: Push Code to GitHub

Make sure all changes are committed and pushed to your GitHub repository:

```bash
git add .
git commit -m "Configure dynamic URLs and Render blueprint"
git push origin main
```

---

## ⚡ Step 3: Deploy to Render

You can deploy using either **Option A (Render Blueprint - Recommended)** or **Option B (Manual Setup)**.

### Option A: 1-Click Blueprint Deployment (Recommended)

1. Go to [dashboard.render.com](https://dashboard.render.com).
2. Click **New +** in the top right > select **Blueprint**.
3. Connect your GitHub repository.
4. Render will read [`render.yaml`](./render.yaml) and automatically configure all 3 services!
5. In the environment variable prompt for `zerodha-backend`, set:
   - `MONGO_URL`: *Your MongoDB connection string from Step 1*
6. Click **Apply**.
7. Once the build completes:
   - Copy your Frontend URL (e.g. `https://zerodha-frontend.onrender.com`).
   - Copy your Dashboard URL (e.g. `https://zerodha-dashboard.onrender.com`).
   - In `zerodha-frontend` settings, add `REACT_APP_DASHBOARD_URL = https://zerodha-dashboard.onrender.com`.
   - In `zerodha-dashboard` settings, add `REACT_APP_FRONTEND_URL = https://zerodha-frontend.onrender.com`.

---

### Option B: Manual Service Deployment

If you prefer to configure each service manually in the Render UI:

#### 1. Deploy the Backend (Web Service)
1. In Render Dashboard, click **New +** > **Web Service**.
2. Select your repository.
3. Configure the following:
   - **Name**: `zerodha-backend`
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
4. Under **Environment Variables**, add:
   - `MONGO_URL`: `<your-mongodb-atlas-connection-string>`
   - `NODE_ENV`: `production`
5. Click **Create Web Service**.
6. *Copy your backend URL (e.g. `https://zerodha-backend.onrender.com`).*

---

#### 2. Deploy the Kite Trading Dashboard (Static Site)
1. In Render Dashboard, click **New +** > **Static Site**.
2. Select your repository.
3. Configure the following:
   - **Name**: `zerodha-dashboard`
   - **Root Directory**: `dashboard`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `build`
4. Under **Environment Variables**, add:
   - `REACT_APP_API_URL`: `https://zerodha-backend.onrender.com`
5. Under **Redirects/Rewrites**, add a rewrite rule:
   - **Source**: `/*`
   - **Destination**: `/index.html`
   - **Action**: `Rewrite`
6. Click **Create Static Site**.
7. *Copy your dashboard URL (e.g. `https://zerodha-dashboard.onrender.com`).*

---

#### 3. Deploy the Frontend Landing Page (Static Site)
1. In Render Dashboard, click **New +** > **Static Site**.
2. Select your repository.
3. Configure the following:
   - **Name**: `zerodha-frontend`
   - **Root Directory**: `frontend`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `build`
4. Under **Environment Variables**, add:
   - `REACT_APP_API_URL`: `https://zerodha-backend.onrender.com`
   - `REACT_APP_DASHBOARD_URL`: `https://zerodha-dashboard.onrender.com`
5. Under **Redirects/Rewrites**, add a rewrite rule:
   - **Source**: `/*`
   - **Destination**: `/index.html`
   - **Action**: `Rewrite`
6. Click **Create Static Site**.

---

## 🔍 Step 4: Verification & Testing

Once deployed:
1. Open your **Frontend Landing Page** URL (`https://zerodha-frontend.onrender.com`).
2. Test navigating to **Signup** and register an account (connects to Backend `/signup`).
3. Click **Dashboard (Kite)** or **Try Kite demo** — it will direct to your live Dashboard.
4. In the Dashboard:
   - Verify that **Holdings** and **Positions** load real-time stock data from the backend.
   - Place a test **Buy** order and verify the order is saved successfully.
