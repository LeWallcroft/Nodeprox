"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../query-keys";
import {
  listManagedUsers,
  listManagedUsersPage,
  replaceManagedUserSeries,
  reviewManagedUser,
} from "./api";
import type {
  ManagedUserRole,
  ManagedUserStatus,
  ReviewUserInput,
} from "./types";

export function useManagedUsers() {
  return useQuery({
    queryKey: queryKeys.users.list,
    queryFn: listManagedUsers,
    retry: false,
  });
}

export function useManagedUsersPage(input: {
  search?: string;
  role?: ManagedUserRole;
  status?: ManagedUserStatus;
  cursor?: string | null;
  limit: number;
}) {
  return useQuery({
    queryKey: [
      ...queryKeys.users.list,
      "management",
      input.search ?? "",
      input.role ?? "",
      input.status ?? "",
      input.cursor ?? "",
      input.limit,
    ],
    queryFn: () => listManagedUsersPage(input),
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

export function useReplaceManagedUserSeries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      seriesIds,
    }: {
      userId: string;
      seriesIds: readonly string[];
    }) => replaceManagedUserSeries(userId, seriesIds),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.users.list }),
        queryClient.invalidateQueries({ queryKey: queryKeys.series.list }),
      ]);
    },
  });
}
