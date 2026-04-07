import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { supabaseClient } from '../../api/supabaseClient';

export const SettingsView: React.FC = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: 'password must be at least 6 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'passwords do not match.' });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
      if (error) {
        setMessage({ type: 'error', text: error.message });
      } else {
        setMessage({ type: 'success', text: 'password updated.' });
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch {
      setMessage({ type: 'error', text: 'something went wrong.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 16, fontWeight: 500, color: '#1a1a1a', marginBottom: 32,
      }}>
        settings
      </h1>

      {/* Account info */}
      <div style={{
        background: '#fdfaf2', border: '1px solid rgba(0,0,0,0.1)',
        borderRadius: 8, padding: '20px 24px', marginBottom: 32,
      }}>
        <div style={{ fontSize: 11, color: '#9a9a9a', letterSpacing: 0.3, marginBottom: 8 }}>ACCOUNT</div>
        <div style={{ fontSize: 14, color: '#1a1a1a' }}>{user?.email ?? '—'}</div>
      </div>

      {/* Change password */}
      <form onSubmit={handlePasswordChange}>
        <div style={{ fontSize: 11, color: '#9a9a9a', letterSpacing: 0.3, marginBottom: 16 }}>CHANGE PASSWORD</div>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ display: 'block', fontSize: 12, color: '#6b6b6b', marginBottom: 6 }}>new password</span>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            autoComplete="new-password"
            style={{
              width: '100%', padding: '10px 12px', fontSize: 14,
              border: '1px solid rgba(0,0,0,0.12)', borderRadius: 6,
              background: '#fdfaf2', color: '#1a1a1a', outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 20 }}>
          <span style={{ display: 'block', fontSize: 12, color: '#6b6b6b', marginBottom: 6 }}>confirm password</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            style={{
              width: '100%', padding: '10px 12px', fontSize: 14,
              border: '1px solid rgba(0,0,0,0.12)', borderRadius: 6,
              background: '#fdfaf2', color: '#1a1a1a', outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </label>

        {message && (
          <div style={{
            padding: '10px 14px', borderRadius: 6, fontSize: 13, marginBottom: 16,
            background: message.type === 'success' ? '#D1FAE5' : '#FEE2E2',
            color: message.type === 'success' ? '#059669' : '#DC2626',
          }}>
            {message.text}
          </div>
        )}

        <button
          type="submit"
          disabled={saving || !newPassword}
          style={{
            padding: '10px 20px', fontSize: 13, fontWeight: 500,
            background: '#c2410c', color: '#fdfaf2', border: 'none',
            borderRadius: 6, cursor: 'pointer',
            opacity: saving || !newPassword ? 0.5 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {saving ? 'saving…' : 'update password'}
        </button>
      </form>

      {/* Sign out */}
      <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', marginTop: 48, paddingTop: 24 }}>
        <button
          type="button"
          onClick={handleSignOut}
          style={{
            padding: '10px 20px', fontSize: 13,
            background: 'none', color: '#c2410c',
            border: '1px solid rgba(194,65,12,0.3)', borderRadius: 6,
            cursor: 'pointer', transition: 'background 0.15s',
          }}
          onMouseOver={e => e.currentTarget.style.background = 'rgba(194,65,12,0.05)'}
          onMouseOut={e => e.currentTarget.style.background = 'none'}
        >
          sign out
        </button>
      </div>
    </div>
  );
};
