import fs from "fs";
import os from "os";
import path from "path";

const GATOR_CONFIG_NAME = ".gatorconfig.json";

// Define the required type for the project
export type Config = {
  dbUrl: string;
  currentUserName?: string;
};

// Function to get the full file path in your system
function getConfigFilePath(): string {
  return path.join(os.homedir(), GATOR_CONFIG_NAME);
}

// Write the configuration to the file
function writeConfig(cfg: Config): void {
  const filePath = getConfigFilePath();
  const data = JSON.stringify({
    db_url: cfg.dbUrl,
    current_user_name: cfg.currentUserName
  }, null, 2);
  fs.writeFileSync(filePath, data, 'utf-8');
}

//Update the current user
export function setUser(cfg: Config, userName: string): void {
  cfg.currentUserName = userName;
  writeConfig(cfg);
}

//Read the configuration from the file
export function readConfig(): Config {
  const filePath = getConfigFilePath();
  const jsonString = fs.readFileSync(filePath, 'utf-8');
  const rawConfig = JSON.parse(jsonString);
  return {
    dbUrl: rawConfig.db_url,
    currentUserName: rawConfig.current_user_name
  };
}