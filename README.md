# Global Counter Click Game MVP

A real-time global counter click game with team-based competition. Users are assigned to teams (A or B) based on their IP address and get 3 votes per day to distribute across 3 counters.

## Features

- **3 Counters**: Users can vote on any of 3 counters
- **Team Competition**: IP-based team assignment (Team A vs Team B)
- **Daily Vote Limit**: 3 votes per person per day (resets at UTC midnight)
- **Real-time Updates**: Live updates via Ably channels
- **Team Scoring**: Sum of all 3 counter values determines the winner

## Setup

### Prerequisites

- Node.js 18+ and npm
- Upstash Redis account (free tier available)
- Ably account (free tier available)

### Installation

1. Clone the repository and install dependencies:

```bash
npm install
```

2. Set up environment variables:

Create a `.env` file in the root directory with the following variables:

```bash
# Upstash Redis Configuration
UPSTASH_REDIS_REST_URL=https://your-redis-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-redis-token

# Ably Real-time Messaging
ABLY_API_KEY=your-ably-api-key

# Admin Authentication (REQUIRED in production)
ADMIN_PASSWORD=your-secure-admin-password
```

### Getting API Keys

#### Upstash Redis

1. Go to [Upstash Console](https://console.upstash.com/)
2. Create a new Redis database
3. Copy the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

#### Ably

1. Go to [Ably Dashboard](https://ably.com/)
2. Create a new app or use an existing one
3. Copy the API Key (you'll need the full key, not just the client key)
4. Set `ABLY_API_KEY` in your `.env` file

#### Admin Password

**IMPORTANT**: Set a strong `ADMIN_PASSWORD` environment variable. The application will not start without it in production. This password is used to access admin features like resetting counters.

### Running the Application

Development:

```bash
npm run dev
```

Build for production:

```bash
npm run build
npm start
```

## Deployment

### Pre-Deployment Checklist

Before deploying to production, ensure:

- [ ] All environment variables are set (see Setup section)
- [ ] `ADMIN_PASSWORD` is set to a strong password
- [ ] Test the application locally with `npm run build`
- [ ] Verify health check endpoint: `/api/health`
- [ ] Test admin login functionality
- [ ] Test vote limiting (3 votes per day)
- [ ] Verify real-time updates work

### Vercel Deployment

1. Push your code to GitHub
2. Import the project in [Vercel](https://vercel.com/)
3. Add environment variables in Vercel dashboard:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `ABLY_API_KEY`
   - `ADMIN_PASSWORD` (required - use a strong password!)
4. Deploy!

The application will automatically build and deploy. After deployment, you can verify it's working by:
- Visiting the main page
- Checking `/api/health` endpoint for service status
- Testing admin login with your `ADMIN_PASSWORD`

## How It Works

- Users are assigned to Team A or Team B based on their IP address hash
- Each user gets 3 votes per day (UTC date)
- Votes can be distributed across any of the 3 counters
- Team score = sum of all 3 counter values
- Positive score = Team A winning, Negative score = Team B winning
- Real-time updates broadcast to all connected clients via Ably

## Tech Stack

- **Next.js 16+** - React framework with App Router
- **Upstash Redis** - Serverless Redis for state storage
- **Ably** - Real-time messaging
- **Tailwind CSS** - Styling
- **TypeScript** - Type safety

## API Endpoints

### Public Endpoints

- `GET /api/counters` - Get current counter values and user's vote status
- `POST /api/click` - Submit a vote (increment/decrement a counter)
- `POST /api/ably/token` - Get Ably authentication token
- `GET /api/health` - Health check endpoint (checks Redis and Ably connectivity)

### Admin Endpoints

- `GET /api/admin/auth` - Check admin authentication status
- `POST /api/admin/auth` - Authenticate as admin (requires password)
- `DELETE /api/admin/auth` - Logout from admin
- `POST /api/admin/reset` - Reset counters/votes (requires admin auth)

## Security Notes

- Admin password is required and must be set via `ADMIN_PASSWORD` environment variable
- Client IDs are stored in httpOnly cookies to prevent XSS manipulation
- All API endpoints validate input types and request bodies
- Vote limiting is enforced server-side using atomic Redis operations
- Admin authentication uses secure, httpOnly cookies

