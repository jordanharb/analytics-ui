import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabaseClient } from '../../api/supabaseClient';

const ASCII_LOGO = `  ┌─────────────────┐
  │  f i e l d      │
  │     n o t e s   │
  └─────────────────┘`;

export const LaunchPage: React.FC = () => {
  const navigate = useNavigate();
  const [handle, setHandle] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.body.style.backgroundColor = '#f6f1e6';
    return () => { document.body.style.backgroundColor = ''; };
  }, []);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({
        email: handle,
        password: passcode,
      });
      if (error) {
        setError('nope. try again.');
        setSubmitting(false);
        return;
      }
      navigate('/map');
    } catch {
      setError('connection error. try again.');
      setSubmitting(false);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSubmit();
  }

  return (
    <main style={{
      minHeight: '100vh',
      background: '#f6f1e6',
      color: '#1a1a1a',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 880,
        border: '1px solid rgba(0,0,0,0.12)',
        borderRadius: 12,
        padding: 56,
        display: 'grid',
        gridTemplateColumns: '1.3fr 1fr',
        gap: 56,
        background: '#fdfaf2',
      }}>
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 320 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6b6b6b' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#c2410c', display: 'inline-block' }} />
            <span>fieldnotes / online</span>
          </div>

          <div>
            <pre style={{ margin: 0, fontSize: 13, lineHeight: 1.4, color: '#1a1a1a', whiteSpace: 'pre' }}>
{ASCII_LOGO}
            </pre>
            <div style={{ marginTop: 28, fontSize: 16, lineHeight: 1.8, color: '#2a2a2a', maxWidth: 400 }}>
              &gt; their playbook,<br />
              &gt; in your inbox.
              <span className="term-cursor" />
            </div>
          </div>

          <div style={{ fontSize: 12, color: '#9a9a9a', maxWidth: 400, lineHeight: 1.7 }}>
            a quiet read on what the other side is up to. for organizers, by organizers. invite only.
          </div>
        </div>

        {/* Right */}
        <div style={{
          borderLeft: '1px solid rgba(0,0,0,0.1)',
          paddingLeft: 40,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 20,
        }}>
          <div style={{ fontSize: 12, color: '#6b6b6b' }}>// access</div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#9a9a9a' }}>handle</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={onKey}
              autoComplete="username"
              style={{
                background: 'transparent', border: 'none', borderBottom: '1px solid rgba(0,0,0,0.15)',
                color: '#1a1a1a', fontSize: 15, padding: '6px 0', outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#9a9a9a' }}>passcode</span>
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              onKeyDown={onKey}
              autoComplete="current-password"
              style={{
                background: 'transparent', border: 'none', borderBottom: '1px solid rgba(0,0,0,0.15)',
                color: '#1a1a1a', fontSize: 15, padding: '6px 0', outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </label>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              marginTop: 12, fontSize: 13, padding: '10px 16px',
              border: '1px solid rgba(0,0,0,0.15)', borderRadius: 4,
              background: 'transparent',
              color: '#1a1a1a', cursor: 'pointer', textAlign: 'center',
              fontFamily: 'inherit', opacity: submitting ? 0.5 : 1,
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onMouseOver={(e) => { e.currentTarget.style.borderColor = '#c2410c'; e.currentTarget.style.color = '#c2410c'; }}
            onMouseOut={(e) => { e.currentTarget.style.borderColor = 'rgba(0,0,0,0.15)'; e.currentTarget.style.color = '#1a1a1a'; }}
          >
            {submitting ? '[ ... ]' : "[ pick up this week's notes ]"}
          </button>

          {error && (
            <div style={{ fontSize: 11, color: '#DC2626' }}>{error}</div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        .term-cursor {
          display: inline-block;
          width: 0.55em;
          height: 1em;
          background: #c2410c;
          vertical-align: -2px;
          margin-left: 2px;
          animation: blink 1.1s steps(1) infinite;
        }
      `}</style>
    </main>
  );
};

export default LaunchPage;
