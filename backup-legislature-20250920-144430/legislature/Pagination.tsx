import React from 'react';

interface PaginationProps {
  currentPage: number;
  totalItems?: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  hasMore?: boolean;
  isLoading?: boolean;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalItems,
  itemsPerPage,
  onPageChange,
  hasMore,
  isLoading = false
}) => {
  const totalPages = totalItems ? Math.ceil(totalItems / itemsPerPage) : undefined;
  const showPrevious = currentPage > 1;
  const showNext = hasMore || (totalPages && currentPage < totalPages);

  const handlePrevious = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (showNext) {
      onPageChange(currentPage + 1);
    }
  };

  const handleLoadMore = () => {
    if (showNext && !isLoading) {
      onPageChange(currentPage + 1);
    }
  };

  // Load More pattern (preferred)
  if (hasMore !== undefined) {
    return (
      <div className="flex justify-center mt-6">
        {(hasMore || currentPage > 1) && (
          <button
            onClick={handleLoadMore}
            disabled={isLoading}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                Loading...
              </>
            ) : hasMore ? (
              'Load More'
            ) : (
              'No more items'
            )}
          </button>
        )}
      </div>
    );
  }

  // Traditional pagination
  return (
    <div className="flex items-center justify-between mt-6">
      <div className="flex items-center gap-2">
        <button
          onClick={handlePrevious}
          disabled={!showPrevious || isLoading}
          className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        
        {totalPages && (
          <span className="px-3 text-sm text-gray-700">
            Page {currentPage} of {totalPages}
          </span>
        )}
        
        <button
          onClick={handleNext}
          disabled={!showNext || isLoading}
          className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>

      {totalItems && (
        <div className="text-sm text-gray-700">
          Showing {((currentPage - 1) * itemsPerPage) + 1} - {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems}
        </div>
      )}
    </div>
  );
};