import 'dotenv/config';
import express from 'express';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import automationConfig from '../api/automation/config.ts';
import automationRun from '../api/automation/run.ts';
import automationRuns from '../api/automation/runs.ts';
import automationAdvance from '../api/automation/advance.ts';
import emailReportsJobs from '../api/email-reports/jobs.ts';
import emailReportsGenerate from '../api/email-reports/generate.ts';
import emailReportsViewer from '../api/email-reports/viewer.ts';
import emailReportsActorPosts from '../api/email-reports/actor-posts.ts';

const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

function adapt(handler: (req: VercelRequest, res: VercelResponse) => Promise<void> | void) {
  return async (req: express.Request, res: express.Response) => {
    try {
      await handler(req as unknown as VercelRequest, res as unknown as VercelResponse);
    } catch (error) {
      console.error('❌ API handler threw an error:', error);
      console.error('   Stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.error('   Environment check:');
      console.error('   - SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING');
      console.error('   - SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING');
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
    }
  };
}

app.all('/api/automation/config', adapt(automationConfig));
app.all('/api/automation/run', adapt(automationRun));
app.all('/api/automation/runs', adapt(automationRuns));
app.all('/api/automation/advance', adapt(automationAdvance));

app.all('/api/email-reports/jobs', adapt(emailReportsJobs));
app.all('/api/email-reports/generate', adapt(emailReportsGenerate));
app.all('/api/email-reports/viewer', adapt(emailReportsViewer));
app.all('/api/email-reports/actor-posts', adapt(emailReportsActorPosts));

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found in dev server' });
});

app.listen(PORT, () => {
  console.log(`Local automation API server listening on http://localhost:${PORT}`);
});
