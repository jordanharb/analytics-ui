import { z } from 'zod';

export interface QueryIntent {
  type: 'events' | 'actors' | 'posts' | 'analytics' | 'complex';
  entities: {
    dates?: string[];
    locations?: string[];
    organizations?: string[];
    people?: string[];
    tags?: string[];
    topics?: string[];
  };
  filters: Record<string, any>;
  requiresVectorSearch: boolean;
  suggestedTools: string[];
}

export class QueryRouter {
  private readonly patterns = {
    dates: /(\d{4}-\d{2}-\d{2}|last \d+ (days?|weeks?|months?)|since \w+|between .+ and .+)/gi,
    locations: /(in |at |from )([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
    organizations: /TPUSA|Turning Point|PragerU|AFPI|Charlie Kirk|Ben Shapiro/gi,
    schools: /school|university|college|campus|education/gi,
    elections: /election|ballot|vote|campaign|candidate/gi,
    tags: {
      School: /school|education|campus|university|college/i,
      Election: /election|ballot|vote|campaign|candidate/i,
      Conference: /conference|summit|convention|event/i,
      Protest: /protest|rally|demonstration|march/i,
      Latino: /latino|hispanic|latinx/i,
      LGBTQ: /lgbtq|transgender|gay|lesbian|queer/i,
    },
  };

  analyzeQuery(query: string): QueryIntent {
    const intent: QueryIntent = {
      type: 'complex',
      entities: {},
      filters: {},
      requiresVectorSearch: false,
      suggestedTools: [],
    };

    // Detect query type
    if (query.match(/rhetoric|sentiment|narrative|talking points/i)) {
      intent.type = 'posts';
      intent.requiresVectorSearch = true;
      intent.suggestedTools.push('search_posts', 'analyze_rhetoric');
    } else if (query.match(/who|actor|person|organization|chapter/i)) {
      intent.type = 'actors';
      intent.suggestedTools.push('get_actor_info');
    } else if (query.match(/event|activity|happening/i)) {
      intent.type = 'events';
      intent.suggestedTools.push('query_events');
    } else if (query.match(/trend|statistic|count|distribution|analysis/i)) {
      intent.type = 'analytics';
      intent.suggestedTools.push('get_analytics');
    }

    // Extract entities
    intent.entities.dates = this.extractDates(query);
    intent.entities.locations = this.extractLocations(query);
    intent.entities.organizations = this.extractOrganizations(query);
    intent.entities.tags = this.extractTags(query);
    intent.entities.topics = this.extractTopics(query);

    // Determine if vector search is needed
    if (query.match(/about|related to|concerning|regarding|similar/i)) {
      intent.requiresVectorSearch = true;
      intent.suggestedTools.push('search_posts');
    }

    // Build filters
    if (intent.entities.dates?.length) {
      intent.filters.date_range = this.parseDateRange(intent.entities.dates);
    }
    if (intent.entities.locations?.length) {
      intent.filters.locations = intent.entities.locations;
    }
    if (intent.entities.tags?.length) {
      intent.filters.tags = intent.entities.tags;
    }

    return intent;
  }

  private extractDates(query: string): string[] {
    const dates: string[] = [];
    const matches = query.match(this.patterns.dates);

    if (matches) {
      dates.push(...matches);
    }

    return dates;
  }

  private extractLocations(query: string): string[] {
    const locations: string[] = [];
    let match;

    while ((match = this.patterns.locations.exec(query)) !== null) {
      locations.push(match[2]);
    }

    // Also check for state abbreviations
    const statePattern = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/g;
    const stateMatches = query.match(statePattern);
    if (stateMatches) {
      locations.push(...stateMatches);
    }

    return [...new Set(locations)];
  }

  private extractOrganizations(query: string): string[] {
    const orgs: string[] = [];
    const matches = query.match(this.patterns.organizations);

    if (matches) {
      orgs.push(...matches);
    }

    return [...new Set(orgs)];
  }

  private extractTags(query: string): string[] {
    const tags: string[] = [];

    for (const [tag, pattern] of Object.entries(this.patterns.tags)) {
      if (pattern.test(query)) {
        tags.push(tag);
      }
    }

    return tags;
  }

  private extractTopics(query: string): string[] {
    // Extract key topics for vector search
    const topicPatterns = [
      /(?:about|regarding|concerning)\s+([^,.?!]+)/gi,
      /"([^"]+)"/g, // Quoted phrases
    ];

    const topics: string[] = [];
    for (const pattern of topicPatterns) {
      let match;
      while ((match = pattern.exec(query)) !== null) {
        topics.push(match[1].trim());
      }
    }

    return topics;
  }

  private parseDateRange(dates: string[]): { start_date?: string; end_date?: string } {
    const range: { start_date?: string; end_date?: string } = {};
    const today = new Date();

    for (const dateStr of dates) {
      if (dateStr.match(/last (\d+) days?/i)) {
        const days = parseInt(dateStr.match(/\d+/)![0]);
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - days);
        range.start_date = startDate.toISOString().split('T')[0];
        range.end_date = today.toISOString().split('T')[0];
      } else if (dateStr.match(/last (\d+) months?/i)) {
        const months = parseInt(dateStr.match(/\d+/)![0]);
        const startDate = new Date(today);
        startDate.setMonth(startDate.getMonth() - months);
        range.start_date = startDate.toISOString().split('T')[0];
        range.end_date = today.toISOString().split('T')[0];
      } else if (dateStr.match(/since (\w+)/i)) {
        // Parse "since September" etc.
        const monthMatch = dateStr.match(/since (\w+)/i);
        if (monthMatch) {
          const monthName = monthMatch[1];
          const date = new Date(`${monthName} 1, ${today.getFullYear()}`);
          if (date > today) {
            date.setFullYear(date.getFullYear() - 1);
          }
          range.start_date = date.toISOString().split('T')[0];
        }
      } else if (dateStr.match(/\d{4}-\d{2}-\d{2}/)) {
        // Direct date
        if (!range.start_date) {
          range.start_date = dateStr;
        } else {
          range.end_date = dateStr;
        }
      }
    }

    return range;
  }

  buildQueryPlan(intent: QueryIntent): Array<{
    tool: string;
    parameters: Record<string, any>;
    order: number;
  }> {
    const plan = [];

    // Determine execution order based on query type
    if (intent.type === 'complex') {
      // For complex queries, we might need multiple tools
      if (intent.requiresVectorSearch) {
        plan.push({
          tool: 'search_posts',
          parameters: {
            query: intent.entities.topics?.join(' ') || '',
            filters: {
              date_range: intent.filters.date_range,
            },
            limit: 100,
          },
          order: 1,
        });
      }

      if (intent.entities.organizations?.length || intent.entities.people?.length) {
        plan.push({
          tool: 'get_actor_info',
          parameters: {
            actor_name: intent.entities.organizations?.[0] || intent.entities.people?.[0],
            include_events: true,
            include_posts: intent.requiresVectorSearch,
          },
          order: 2,
        });
      }

      plan.push({
        tool: 'query_events',
        parameters: {
          filters: intent.filters,
        },
        order: 3,
      });
    } else {
      // Simple query - use primary tool
      const primaryTool = intent.suggestedTools[0];
      if (primaryTool) {
        plan.push({
          tool: primaryTool,
          parameters: this.buildToolParameters(primaryTool, intent),
          order: 1,
        });
      }
    }

    return plan.sort((a, b) => a.order - b.order);
  }

  private buildToolParameters(tool: string, intent: QueryIntent): Record<string, any> {
    switch (tool) {
      case 'query_events':
        return { filters: intent.filters };

      case 'search_posts':
        return {
          query: intent.entities.topics?.join(' ') || '',
          filters: intent.filters,
          limit: 50,
        };

      case 'get_actor_info':
        return {
          actor_name: intent.entities.organizations?.[0] || intent.entities.people?.[0],
          include_events: true,
          include_posts: true,
        };

      case 'analyze_rhetoric':
        return {
          topic: intent.entities.topics?.[0] || '',
          date_range: intent.filters.date_range,
          actor_filters: {
            organizations: intent.entities.organizations,
          },
        };

      case 'get_analytics':
        return {
          metric_type: 'event_trends',
          date_range: intent.filters.date_range,
          filters: {
            tags: intent.entities.tags,
            organizations: intent.entities.organizations,
          },
        };

      default:
        return {};
    }
  }
}