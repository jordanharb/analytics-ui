import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  fetchBillOverview, 
  fetchBillVoteTimeline, 
  fetchBillRTSPositions,
  fetchBillVoteDetails 
} from '../../lib/legislature-api';
import { Table, formatDate } from '../../components/legislature/Table';
import type { Column } from '../../components/legislature/Table';
import type { 
  BillOverview, 
  BillVoteTimeline, 
  RTSPosition,
  BillVoteDetail 
} from '../../lib/legislature-types';

export const BillPage: React.FC = () => {
  const { billId } = useParams<{ billId: string }>();
  const [bill, setBill] = useState<BillOverview | null>(null);
  const [voteTimeline, setVoteTimeline] = useState<BillVoteTimeline[]>([]);
  const [rtsPositions, setRtsPositions] = useState<RTSPosition[]>([]);
  const [expandedVote, setExpandedVote] = useState<string | null>(null);
  const [voteDetails, setVoteDetails] = useState<BillVoteDetail[]>([]);
  const [rtsSearchQuery, setRtsSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingVoteDetails, setIsLoadingVoteDetails] = useState(false);

  useEffect(() => {
    if (billId) {
      loadData();
    }
  }, [billId]);

  const loadData = async () => {
    if (!billId) return;
    
    setIsLoading(true);
    try {
      const [overviewData, timelineData, rtsData] = await Promise.all([
        fetchBillOverview(Number(billId)),
        fetchBillVoteTimeline(Number(billId)),
        fetchBillRTSPositions(Number(billId))
      ]);
      
      setBill(overviewData);
      setVoteTimeline(timelineData);
      setRtsPositions(rtsData);
    } catch (error) {
      console.error('Failed to load bill data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const generateVoteKey = (stage: BillVoteTimeline) => `${stage.date}-${stage.venue}`;

  const toggleVoteExpansion = async (stage: BillVoteTimeline) => {
    const voteKey = generateVoteKey(stage);
    if (expandedVote === voteKey) {
      setExpandedVote(null);
    } else {
      setExpandedVote(voteKey);
      
      if (voteDetails.length === 0) {
        setIsLoadingVoteDetails(true);
        try {
          const details = await fetchBillVoteDetails(Number(billId));
          setVoteDetails(details);
        } catch (error) {
          console.error('Failed to load vote details:', error);
        } finally {
          setIsLoadingVoteDetails(false);
        }
      }
    }
  };

  const filteredRtsPositions = rtsPositions.filter(rts => {
    if (!rtsSearchQuery) return true;
    const query = rtsSearchQuery.toLowerCase();
    return (
      rts.entity_name?.toLowerCase().includes(query) ||
      rts.representing?.toLowerCase().includes(query) ||
      rts.position?.toLowerCase().includes(query)
    );
  });

  const getVoteColor = (vote: string) => {
    const voteUpper = vote?.toUpperCase();
    if (['Y', 'YES', 'AYE'].includes(voteUpper)) return 'text-green-600';
    if (['N', 'NO', 'NAY'].includes(voteUpper)) return 'text-red-600';
    if (['NV', 'NOT VOTING', 'ABSENT'].includes(voteUpper)) return 'text-gray-400';
    return 'text-gray-600';
  };

  const getVoteBadge = (vote: string) => {
    const voteUpper = vote?.toUpperCase();
    if (['Y', 'YES', 'AYE'].includes(voteUpper)) {
      return <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded">YES</span>;
    }
    if (['N', 'NO', 'NAY'].includes(voteUpper)) {
      return <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded">NO</span>;
    }
    if (['NV', 'NOT VOTING', 'ABSENT'].includes(voteUpper)) {
      return <span className="px-2 py-1 text-xs bg-gray-100 text-gray-400 rounded">{vote}</span>;
    }
    return <span className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded">{vote}</span>;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-12 w-12 border-4 border-blue-500 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!bill) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Bill Not Found</h2>
          <Link to="/legislature" className="text-blue-600 hover:text-blue-800">
            Back to Legislature Home
          </Link>
        </div>
      </div>
    );
  }

  const rtsColumns: Column<RTSPosition>[] = [
    {
      key: 'entity',
      header: 'Entity',
      accessor: (item) => item.entity_name
    },
    {
      key: 'representing',
      header: 'Representing',
      accessor: (item) => item.representing || 'Self'
    },
    {
      key: 'position',
      header: 'Position',
      accessor: (item) => (
        <span className={`px-2 py-1 text-xs rounded-full font-medium ${
          item.position === 'FOR' ? 'bg-green-100 text-green-800' :
          item.position === 'AGAINST' ? 'bg-red-100 text-red-800' :
          'bg-gray-100 text-gray-800'
        }`}>
          {item.position}
        </span>
      )
    },
    {
      key: 'date',
      header: 'Date Filed',
      accessor: (item) => formatDate(item.date_filed)
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link 
            to="/legislature"
            className="text-gray-500 hover:text-gray-700 flex items-center gap-2 text-sm"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Legislature Home
          </Link>
        </div>
      </div>

      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{bill.bill_number}</h1>
              <p className="mt-2 text-lg text-gray-600">{bill.title}</p>
              {bill.short_title && (
                <p className="mt-1 text-sm text-gray-500">({bill.short_title})</p>
              )}
            </div>
            <div className="text-right">
              <span className={`inline-block px-3 py-1 text-sm rounded-full font-medium ${
                bill.status === 'PASSED' ? 'bg-green-100 text-green-800' :
                bill.status === 'FAILED' ? 'bg-red-100 text-red-800' :
                'bg-yellow-100 text-yellow-800'
              }`}>
                {bill.status}
              </span>
              {bill.governor_action && (
                <div className="mt-2 text-sm text-gray-600">
                  Governor: {bill.governor_action}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-6 text-sm text-gray-600">
            <span>Introduced: {formatDate(bill.introduced_date)}</span>
            {bill.primary_sponsor && (
              <span>Primary Sponsor: {bill.primary_sponsor}</span>
            )}
            {bill.sponsor_count && (
              <span>{bill.sponsor_count} Total Sponsors</span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Vote Timeline with Expandable Roll Calls */}
        {voteTimeline.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Vote Timeline</h2>
            <div className="space-y-4">
              {voteTimeline.map((stage, index) => {
                const voteKey = generateVoteKey(stage);
                return (
                  <div key={voteKey} className="border rounded-lg">
                    <div 
                      className="flex items-center gap-4 p-4 hover:bg-gray-50 cursor-pointer"
                      onClick={() => toggleVoteExpansion(stage)}
                    >
                      <div className="flex-shrink-0">
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                          stage.result === 'PASSED' ? 'bg-green-100 text-green-600' :
                          stage.result === 'FAILED' ? 'bg-red-100 text-red-600' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {index + 1}
                        </div>
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">{stage.stage} - {stage.chamber}</div>
                        <div className="text-sm text-gray-600">
                          {formatDate(stage.date)} • {stage.result}
                        </div>
                        <div className="text-sm text-gray-500 mt-1">
                          Yes: {stage.yes_votes} | No: {stage.no_votes}
                          {stage.absent_votes && ` | Absent: ${stage.absent_votes}`}
                        </div>
                      </div>
                      <svg
                        className={`h-5 w-5 text-gray-400 transition-transform ${
                          expandedVote === voteKey ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>

                    {/* Expanded Roll Call */}
                    {expandedVote === voteKey && (
                      <div className="border-t bg-gray-50 p-4">
                        {isLoadingVoteDetails ? (
                          <div className="flex justify-center py-4">
                            <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                          </div>
                        ) : voteDetails.length > 0 ? (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-700 mb-3">Roll Call</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                              {voteDetails.filter(detail => detail.vote_date === stage.date && detail.venue === stage.venue).map((detail, idx) => (
                                <div key={idx} className="flex items-center justify-between text-sm bg-white p-2 rounded">
                                  <Link 
                                    to={`/legislature/person/${detail.person_id}`}
                                    className="text-blue-600 hover:text-blue-800"
                                  >
                                    {detail.legislator_name}
                                  </Link>
                                  <span className={`font-medium ${getVoteColor(detail.vote)}`}>
                                    {getVoteBadge(detail.vote)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-gray-500 text-center py-4">
                            No roll call details available
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              )}
            </div>
          </div>
        )}

        {/* RTS Positions with Search */}
        {rtsPositions.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">
                Request to Speak Positions
                <span className="ml-2 text-sm text-gray-500">({filteredRtsPositions.length} of {rtsPositions.length})</span>
              </h2>
              <input
                type="text"
                placeholder="Search RTS positions..."
                value={rtsSearchQuery}
                onChange={(e) => setRtsSearchQuery(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-xs"
              />
            </div>
            
            {/* Summary Stats */}
            <div className="mb-4 flex gap-4 text-sm">
              <span className="px-3 py-1 bg-green-50 text-green-700 rounded-full">
                For: {rtsPositions.filter(r => r.position === 'FOR').length}
              </span>
              <span className="px-3 py-1 bg-red-50 text-red-700 rounded-full">
                Against: {rtsPositions.filter(r => r.position === 'AGAINST').length}
              </span>
              <span className="px-3 py-1 bg-gray-50 text-gray-700 rounded-full">
                Neutral: {rtsPositions.filter(r => r.position === 'NEUTRAL').length}
              </span>
            </div>

            <Table 
              data={filteredRtsPositions} 
              columns={rtsColumns} 
              emptyMessage="No RTS positions match your search"
            />
          </div>
        )}
      </div>
    </div>
  );
};