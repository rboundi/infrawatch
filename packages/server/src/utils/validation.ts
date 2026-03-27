import { body } from "express-validator";

const VALID_SCAN_TARGET_TYPES = [
  "ssh_linux",
  "winrm",
  "kubernetes",
  "aws",
  "vmware",
  "docker",
] as const;

export const validateScanTarget = [
  body("name")
    .isString()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage("name is required and must be 1-255 characters"),

  body("type")
    .isString()
    .isIn([...VALID_SCAN_TARGET_TYPES])
    .withMessage(
      `type must be one of: ${VALID_SCAN_TARGET_TYPES.join(", ")}`
    ),

  body("connectionConfig")
    .isObject()
    .withMessage("connectionConfig must be an object"),

  body("scanIntervalHours")
    .optional()
    .isInt({ min: 1, max: 168 })
    .withMessage("scanIntervalHours must be an integer between 1 and 168"),

  body("enabled")
    .optional()
    .isBoolean()
    .withMessage("enabled must be a boolean"),
];
