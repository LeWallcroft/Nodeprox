declare module "unzipper" {
  const unzipper: {
    Parse(options: { forceStream: boolean }): NodeJS.ReadWriteStream;
  };
  export default unzipper;
}
