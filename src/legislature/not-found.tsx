export default function NotFound() {
  return (
    <div style={{
      textAlign: 'center',
      padding: '4rem 1rem',
    }}>
      <div style={{
        fontSize: '6rem',
        marginBottom: '1rem',
        filter: 'grayscale(1)',
      }}>
        🏛️
      </div>
      <h1 style={{
        fontSize: '2.5rem',
        fontWeight: '700',
        marginBottom: '1rem',
        color: '#1f2937',
      }}>
        404 - Page Not Found
      </h1>
      <p style={{
        fontSize: '1.1rem',
        color: '#6b7280',
        marginBottom: '2rem',
        maxWidth: '500px',
        margin: '0 auto 2rem',
      }}>
        The page or entity you're looking for doesn't exist. 
        It may have been removed or the URL might be incorrect.
      </p>
      <a 
        href="/"
        style={{
          display: 'inline-block',
          padding: '0.75rem 2rem',
          fontSize: '1rem',
          fontWeight: '600',
          color: 'white',
          backgroundColor: '#0066cc',
          textDecoration: 'none',
          borderRadius: '0.5rem',
          transition: 'background-color 0.2s ease',
        }}
      >
        Return to Search
      </a>
    </div>
  );
}