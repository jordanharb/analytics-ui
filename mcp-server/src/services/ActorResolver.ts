import { SupabaseClient } from '@supabase/supabase-js';

export class ActorResolver {
  constructor(private supabase: SupabaseClient) {}

  async getActorInfo(params: any) {
    try {
      const {
        actor_id,
        actor_name,
        actor_type,
        include_events = false,
        include_posts = false,
        include_relationships = true,
      } = params;

      // Build query
      let query = this.supabase
        .from('v2_actors')
        .select('*');

      // Apply filters
      if (actor_id) {
        query = query.eq('id', actor_id);
      } else if (actor_name) {
        query = query.ilike('name', `%${actor_name}%`);
      }

      if (actor_type) {
        query = query.eq('actor_type', actor_type);
      }

      const { data: actors, error } = await query;

      if (error) throw error;

      if (!actors || actors.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'No actors found matching the criteria' }, null, 2),
            },
          ],
        };
      }

      // Process each actor
      const enrichedActors = await Promise.all(
        actors.map(async (actor) => {
          const result: any = {
            id: actor.id,
            type: actor.actor_type,
            name: actor.name,
            location: {
              city: actor.city,
              state: actor.state,
              region: actor.region,
            },
            about: actor.about,
            should_scrape: actor.should_scrape,
            profiles: this.extractProfiles(actor),
          };

          // Get usernames
          const { data: usernames } = await this.supabase
            .from('v2_actor_usernames')
            .select('*')
            .eq('actor_id', actor.id);

          result.usernames = usernames?.map(u => ({
            platform: u.platform,
            username: u.username,
            url: u.url,
            is_primary: u.is_primary,
            follower_count: u.follower_count,
          })) || [];

          // Get relationships if requested
          if (include_relationships) {
            result.relationships = await this.getActorRelationships(actor.id, actor.actor_type);
          }

          // Get events if requested
          if (include_events) {
            result.events = await this.getActorEvents(actor.id);
          }

          // Get posts if requested
          if (include_posts) {
            result.posts = await this.getActorPosts(actor.id);
          }

          // Extract additional data based on actor type
          if (actor.actor_type === 'person' && actor.data) {
            result.person_details = {
              role: actor.custom_text_1,
              organization: actor.custom_text_2,
              division: actor.custom_text_3,
              status: actor.custom_text_4,
            };
          } else if (actor.actor_type === 'organization' && actor.data) {
            result.org_details = {
              type: actor.data.type,
              parent_organization: actor.data.parent_organization,
              focus: actor.data.summary_focus,
              scope: actor.data.region_scope,
            };
          } else if (actor.actor_type === 'chapter' && actor.data) {
            result.chapter_details = {
              institution_type: actor.custom_text_1,
              status: actor.data.misc?.status,
              officers: actor.data.misc?.officers,
              coordinator: {
                name: actor.data.misc?.coordinator_name,
                email: actor.data.misc?.coordinator_email,
              },
              representative: {
                name: actor.data.misc?.representative_name,
                email: actor.data.misc?.representative_email,
              },
            };
          }

          return result;
        })
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              actor_count: enrichedActors.length,
              actors: enrichedActors,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get actor info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private extractProfiles(actor: any) {
    const profiles: any = {};

    if (actor.x_profile_data) {
      profiles.twitter = {
        username: actor.x_profile_data.username,
        display_name: actor.x_profile_data.displayname,
        followers: actor.x_profile_data.followersCount,
        verified: actor.x_profile_data.verified || actor.x_profile_data.blue,
        bio: actor.x_profile_data.rawDescription,
      };
    }

    if (actor.instagram_profile_data) {
      profiles.instagram = {
        username: actor.instagram_profile_data.username,
        display_name: actor.instagram_profile_data.full_name,
        followers: actor.instagram_profile_data.followers,
        bio: actor.instagram_profile_data.biography,
      };
    }

    if (actor.truth_social_profile_data) {
      profiles.truth_social = {
        username: actor.truth_social_profile_data.username,
        display_name: actor.truth_social_profile_data.display_name,
        followers: actor.truth_social_profile_data.followers_count,
      };
    }

    return profiles;
  }

  private async getActorRelationships(actorId: string, actorType: string) {
    const relationships: any = {};

    // Get links where this actor is the source
    const { data: outgoingLinks } = await this.supabase
      .from('v2_actor_links')
      .select(`
        *,
        to_actor:v2_actors!v2_actor_links_to_actor_id_fkey(
          id,
          name,
          actor_type
        )
      `)
      .eq('from_actor_id', actorId)
      .limit(50);

    // Get links where this actor is the target
    const { data: incomingLinks } = await this.supabase
      .from('v2_actor_links')
      .select(`
        *,
        from_actor:v2_actors!v2_actor_links_from_actor_id_fkey(
          id,
          name,
          actor_type
        )
      `)
      .eq('to_actor_id', actorId)
      .limit(50);

    relationships.affiliations = outgoingLinks?.map(link => ({
      actor: {
        id: link.to_actor.id,
        name: link.to_actor.name,
        type: link.to_actor.actor_type,
      },
      role: link.role,
      relationship: link.relationship,
      is_primary: link.is_primary,
      start_date: link.start_date,
      end_date: link.end_date,
    })) || [];

    relationships.associated_with = incomingLinks?.map(link => ({
      actor: {
        id: link.from_actor.id,
        name: link.from_actor.name,
        type: link.from_actor.actor_type,
      },
      role: link.role,
      relationship: link.relationship,
      start_date: link.start_date,
      end_date: link.end_date,
    })) || [];

    return relationships;
  }

  private async getActorEvents(actorId: string) {
    const { data: eventLinks } = await this.supabase
      .from('v2_event_actor_links')
      .select(`
        event_id,
        v2_events(
          id,
          event_name,
          event_date,
          city,
          state,
          category_tags,
          confidence_score
        )
      `)
      .eq('actor_id', actorId)
      .limit(100);

    return eventLinks?.map(link => {
      const event = link.v2_events as any;
      return {
        id: event?.id,
        name: event?.event_name,
        date: event?.event_date,
        location: `${event?.city}, ${event?.state}`,
        tags: event?.category_tags || [],
        confidence: event?.confidence_score,
      };
    }) || [];
  }

  private async getActorPosts(actorId: string) {
    const { data: posts } = await this.supabase
      .from('v2_social_media_posts')
      .select('*')
      .eq('linked_actor_id', actorId)
      .order('post_timestamp', { ascending: false })
      .limit(50);

    return posts?.map(post => ({
      id: post.id,
      platform: post.platform,
      timestamp: post.post_timestamp,
      content: post.content_text?.substring(0, 500),
      engagement: {
        likes: post.like_count,
        replies: post.reply_count,
        shares: post.share_count,
      },
      url: post.post_url,
    })) || [];
  }

  async resolveUnknownActors(limit: number = 100) {
    try {
      // Get unknown actors that need resolution
      const { data: unknownActors, error } = await this.supabase
        .from('v2_unknown_actors')
        .select('*')
        .eq('review_status', 'pending')
        .order('mention_count', { ascending: false })
        .limit(limit);

      if (error) throw error;

      const resolutionSuggestions = [];

      for (const unknown of unknownActors || []) {
        // Try to find matching actors
        const suggestions = await this.findMatchingActors(unknown);

        resolutionSuggestions.push({
          unknown_actor: {
            id: unknown.id,
            username: unknown.detected_username,
            platform: unknown.platform,
            mention_count: unknown.mention_count,
            profile: {
              display_name: unknown.profile_displayname,
              bio: unknown.profile_bio,
              location: unknown.profile_location,
            },
          },
          suggested_matches: suggestions,
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              total_unknown: resolutionSuggestions.length,
              resolution_suggestions: resolutionSuggestions,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to resolve unknown actors: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async findMatchingActors(unknown: any) {
    const suggestions = [];

    // Search by username
    const { data: usernameMatches } = await this.supabase
      .from('v2_actor_usernames')
      .select(`
        actor_id,
        username,
        platform,
        v2_actors(
          id,
          name,
          actor_type
        )
      `)
      .eq('username', unknown.detected_username)
      .eq('platform', unknown.platform);

    if (usernameMatches?.length) {
      suggestions.push(...usernameMatches.map(match => {
        const actor = match.v2_actors as any;
        return {
          confidence: 'high',
          reason: 'exact_username_match',
          actor: {
            id: actor?.id,
            name: actor?.name,
            type: actor?.actor_type,
          },
        };
      }));
    }

    // Search by display name if available
    if (unknown.profile_displayname && suggestions.length === 0) {
      const { data: nameMatches } = await this.supabase
        .from('v2_actors')
        .select('id, name, actor_type')
        .ilike('name', `%${unknown.profile_displayname}%`)
        .limit(5);

      if (nameMatches?.length) {
        suggestions.push(...nameMatches.map(match => ({
          confidence: 'medium',
          reason: 'name_similarity',
          actor: {
            id: match.id,
            name: match.name,
            type: match.actor_type,
          },
        })));
      }
    }

    return suggestions;
  }
}