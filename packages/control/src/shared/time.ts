export type Clock = () => Date;

export function systemClock(): Date {
  return new Date();
}
