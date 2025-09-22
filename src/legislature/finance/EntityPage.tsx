import React from 'react';
import { useParams } from 'react-router-dom';
import EntityDetailView from '../../components/finance/EntityDetailView';

const EntityPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const entityId = Number(id);

  if (!Number.isFinite(entityId) || entityId <= 0) {
    return <div>Invalid entity ID</div>;
  }

  return <EntityDetailView entityId={entityId} />;
};

export default EntityPage;
