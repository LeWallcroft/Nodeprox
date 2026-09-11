export type HelpViewModel = {
  commands: readonly { name: string; description: string }[];
};

export const defaultHelpViewModel: HelpViewModel = {
  commands: [
    {
      name: "/vincular",
      description: "Vincula Discord con tu cuenta NodeProx.",
    },
    {
      name: "/autorizar-serie",
      description: "Autoriza a un usuario para crear una Serie.",
    },
    {
      name: "/panel",
      description: "Abre el panel de acciones del bot.",
    },
    { name: "/ayuda", description: "Muestra esta ayuda." },
  ],
};
