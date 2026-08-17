import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useReadIds() {
  return useQuery({
    queryKey: ['read-state'],
    queryFn: async () => new Set(await api.listReadIds()),
    staleTime: Infinity,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markRead(id),
    onMutate: (id: string) => {
      qc.setQueryData<Set<string>>(['read-state'], (prev) => new Set(prev).add(id));
    },
    // hasUnread on the X timeline summary list is computed server-side —
    // refetch it so a card's dot clears without waiting out its staleTime.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['x-timelines'] }),
  });
}

export function useMarkUnread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markUnread(id),
    onMutate: (id: string) => {
      qc.setQueryData<Set<string>>(['read-state'], (prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['x-timelines'] }),
  });
}
