import React from 'react';

export default function FullScreenLoader({ title = 'Synchronisation…', percent = 0, detail = '' }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-[90%] max-w-md p-6 text-center">
        <div className="text-xl font-semibold mb-2">{title}</div>
        <div className="w-full h-3 bg-gray-200 rounded overflow-hidden mb-2">
          <div className="h-full bg-green-600 transition-all" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
        </div>
        <div className="text-sm text-gray-600">{Math.round(percent)}% {detail ? `— ${detail}` : ''}</div>
      </div>
    </div>
  );
}
