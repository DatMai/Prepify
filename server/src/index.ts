import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import express from 'express';
import cors from 'cors';
import passport from 'passport';
import swaggerUi from 'swagger-ui-express';
import authRouter from './routes/auth';
import oauthRouter from './routes/oauth';
import progressRouter from './routes/progress';
import streakRouter from './routes/streak';
import leaderboardRouter from './routes/leaderboard';
import quizSessionsRouter from './routes/quizSessions';
import dailyRouter from './routes/daily';
import { swaggerSpec } from './swagger';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json());
app.use(passport.initialize());

app.use('/auth', authRouter);
app.use('/auth', oauthRouter);
app.use('/progress', progressRouter);
app.use('/streak', streakRouter);
app.use('/leaderboard', leaderboardRouter);
app.use('/quiz-sessions', quizSessionsRouter);
app.use('/daily', dailyRouter);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`);
});
