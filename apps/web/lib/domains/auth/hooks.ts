"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../query-keys";
import { getCapabilities, login, logout, register } from "./api";
import type { LoginInput, RegistrationInput } from "./types";

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => login(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
    },
  });
}

export function useCapabilities() {
  return useQuery({
    queryKey: queryKeys.auth.capabilities,
    queryFn: getCapabilities,
    retry: false,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.auth.session });
      queryClient.removeQueries({ queryKey: queryKeys.auth.capabilities });
    },
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (input: RegistrationInput) => register(input),
  });
}
