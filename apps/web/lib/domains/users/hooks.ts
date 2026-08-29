"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../query-keys";
import { listManagedUsers, reviewManagedUser } from "./api";
import type { ReviewUserInput } from "./types";

export function useManagedUsers() {
  return useQuery({
    queryKey: queryKeys.users.list,
    queryFn: listManagedUsers,
    retry: false,
  });
}

export function useReviewManagedUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      input,
    }: {
      userId: string;
      input: ReviewUserInput;
    }) => reviewManagedUser(userId, input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.users.list }),
  });
}
