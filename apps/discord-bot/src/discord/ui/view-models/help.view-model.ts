export type HelpViewModel = {
  commands: readonly { name: string; description: string }[];
};

export const defaultHelpViewModel: HelpViewModel = {
  commands: [
    {
      name: "/vincular",
      description: "Vincula tu cuenta Discord con NodeProx.",
    },
    {
      name: "/autorizar-serie",
      description: "Autoriza a un usuario vinculado a crear una Serie.",
    },
    { name: "/ayuda", description: "Muestra esta ayuda." },
  ],
};
