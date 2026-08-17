import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useXTimelines() {
  return useQuery({
    queryKey: ['x-timelines'],
    queryFn: () => api.listXTimelines(),
    staleTime: 60_000,
  });
}

export function useXTimeline(handle: string | undefined) {
  return useQuery({
    queryKey: ['x-timeline', handle],
    queryFn: () => api.getXTimeline(handle!),
    enabled: Boolean(handle),
    staleTime: 30_000,
  });
}
