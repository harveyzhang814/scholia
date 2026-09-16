import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useCreator(key: string | undefined) {
  return useQuery({
    queryKey: ['creator', key],
    queryFn: () => api.getCreator(key!),
    enabled: Boolean(key),
    staleTime: 30_000,
  });
}
