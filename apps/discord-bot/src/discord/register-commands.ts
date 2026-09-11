import { REST, Routes, SlashCommandBuilder } from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("vincular")
    .setDescription("Vincula tu cuenta Discord con NodeProx.")
    .addStringOption((option) =>
      option
        .setName("codigo")
        .setDescription("Código generado en NodeProx")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(64),
    ),
  new SlashCommandBuilder()
    .setName("autorizar-serie")
    .setDescription("Autoriza a un usuario a crear una Serie."),
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Abre el panel de acciones de NodeProx."),
  new SlashCommandBuilder()
    .setName("ayuda")
    .setDescription("Muestra los comandos disponibles de NodeProx."),
].map((command) => command.toJSON());

export async function registerGuildCommands(input: {
  applicationId: string;
  guildId: string;
  botToken: string;
  rest?: REST;
}) {
  const rest =
    input.rest ?? new REST({ version: "10" }).setToken(input.botToken);
  await rest.put(
    Routes.applicationGuildCommands(input.applicationId, input.guildId),
    { body: commandDefinitions },
  );
}
