# Deployment Guide

This guide covers deploying the RTS Online game to various platforms.

## Database Options

The game supports multiple database backends via environment variables:

- **SQLite** (default): File-based, works locally and on Railway
- **Turso**: Serverless SQLite-compatible, perfect for Vercel
- **PostgreSQL**: Traditional SQL database, works everywhere

Set `DATABASE_TYPE` environment variable to choose:
- `sqlite` (default)
- `turso`
- `postgres`

## Railway Deployment (Recommended for SQLite)

Railway supports persistent volumes, making SQLite a great choice.

### Steps:

1. **Install Railway CLI**:
   ```bash
   npm i -g @railway/cli
   railway login
   ```

2. **Create a new project**:
   ```bash
   railway init
   ```

3. **Add persistent volume for database**:
   - In Railway dashboard, go to your service
   - Add a volume mount at `/data`
   - Set environment variable: `DATABASE_PATH=/data/rts-online.db`

4. **Set environment variables**:
   ```bash
   railway variables set DATABASE_TYPE=sqlite
   railway variables set DATABASE_PATH=/data/rts-online.db
   railway variables set PORT=3000
   ```

5. **Deploy**:
   ```bash
   railway up
   ```

The `railway.json` file is already configured for you.

## Vercel Deployment (Serverless)

Vercel is serverless, so SQLite won't work. Use **Turso** instead.

### Steps:

1. **Create Turso account**:
   - Go to https://turso.tech
   - Create a database
   - Get your `DATABASE_URL` and `AUTH_TOKEN`

2. **Set environment variables in Vercel**:
   - `DATABASE_TYPE=turso`
   - `DATABASE_URL=libsql://your-database-url`
   - `TURSO_AUTH_TOKEN=your-auth-token`
   - `PORT=3000` (Vercel sets this automatically)

3. **Deploy**:
   ```bash
   vercel
   ```

### ⚠️ Important Note on Vercel:
Vercel is serverless, which means:
- Each function invocation is stateless
- **WebSocket connections (Socket.io) don't work well** on Vercel's serverless functions
- Consider using Railway or Render instead for real-time games
- Or use Vercel Edge Functions with a different WebSocket service

## Render Deployment

Render supports persistent disks and WebSockets.

### Steps:

1. **Create a new Web Service** on Render
2. **Connect your Git repository**
3. **Build settings**:
   - Build Command: `pnpm install && pnpm --filter shared build && pnpm --filter server build`
   - Start Command: `cd server && pnpm start`
4. **Environment variables**:
   - `DATABASE_TYPE=sqlite`
   - `DATABASE_PATH=/opt/render/project/src/data/rts-online.db`
   - `PORT=10000` (Render sets this)
5. **Add a persistent disk** (optional, for SQLite):
   - In Render dashboard → Disks
   - Mount at `/data`

## Environment Variables Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_TYPE` | Database type: `sqlite`, `turso`, `postgres` | `sqlite` |
| `DATABASE_URL` | Connection string (Turso/Postgres) or file path (SQLite) | `./rts-online.db` |
| `DATABASE_PATH` | SQLite file path (alternative to DATABASE_URL) | `./rts-online.db` |
| `TURSO_AUTH_TOKEN` | Turso authentication token (required for Turso) | - |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment: `development` or `production` | `development` |

## Client Deployment

The client is a static React app and can be deployed anywhere:

### Vercel (Client only):
```bash
cd client
vercel
```

### Netlify:
```bash
cd client
netlify deploy --prod
```

### Update client socket URL:
For production, update `client/src/socket.ts` to use your server URL:

```typescript
export const socket = io(process.env.VITE_SERVER_URL || 'http://localhost:3000', {
  autoConnect: true,
  // ...
});
```

Set `VITE_SERVER_URL` in your build environment.

## Recommended Setup

- **Development**: SQLite (local file)
- **Railway**: SQLite with persistent volume ✅ **Best for real-time games**
- **Vercel**: Turso (serverless SQLite) ⚠️ **WebSocket limitations**
- **Render**: SQLite with persistent disk ✅ **Good alternative**

## Troubleshooting

### SQLite "database is locked"
- Ensure only one process accesses the database
- Use WAL mode (already enabled)
- Consider switching to Turso/Postgres for multi-instance deployments

### Turso connection errors
- Verify `DATABASE_URL` and `TURSO_AUTH_TOKEN` are set correctly
- Check Turso dashboard for database status
- Ensure `@libsql/client` is installed

### WebSocket issues on Vercel
- Vercel's serverless functions don't support long-lived WebSocket connections
- **Use Railway or Render instead** for real-time games
- Or use Vercel Edge Functions with a different WebSocket service

## Quick Start Commands

### Railway:
```bash
railway login
railway init
railway variables set DATABASE_TYPE=sqlite DATABASE_PATH=/data/rts-online.db
railway up
```

### Vercel (with Turso):
```bash
# Set env vars in Vercel dashboard first
vercel
```

### Render:
```bash
# Configure via Render dashboard
git push origin main  # Auto-deploys
```
