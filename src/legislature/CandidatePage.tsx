'use client';

import React from 'react';
import { useParams } from 'react-router-dom';
import EntityDetailView from '../components/finance/EntityDetailView';

const CandidatePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const entityId = Number(id);

  if (!Number.isFinite(entityId) || entityId <= 0) {
    return (
      <div style={{ padding: '2rem', color: '#6b7280' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem', color: '#374151' }}>
          Invalid entity
        </h2>
        <p>We could not determine which committee to load. Please select an entity from search and try again.</p>
      </div>
    );
  }

  return <EntityDetailView entityId={entityId} />;
};

export default CandidatePage;

