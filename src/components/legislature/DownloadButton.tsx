import React, { useState } from 'react';

interface DownloadButtonProps {
  url: string;
  filename?: string;
  label?: string;
  className?: string;
  method?: 'GET' | 'POST';
  body?: any;
}

export const DownloadButton: React.FC<DownloadButtonProps> = ({
  url,
  filename,
  label = 'Download CSV',
  className = '',
  method = 'GET',
  body
}) => {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    setIsDownloading(true);
    
    try {
      if (method === 'GET') {
        // Simple GET download - open in new tab
        window.open(url, '_blank');
      } else {
        // POST request with body
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          throw new Error('Download failed');
        }

        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename || 'download.csv';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(downloadUrl);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download file. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={isDownloading}
      className={`
        inline-flex items-center gap-2 px-4 py-2 
        bg-green-600 text-white rounded-md 
        hover:bg-green-700 disabled:opacity-50 
        disabled:cursor-not-allowed transition-colors
        ${className}
      `}
    >
      {isDownloading ? (
        <>
          <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
          Downloading...
        </>
      ) : (
        <>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
};