export const TIME_FORMAT = {
    hour: '2-digit',
    minute: 'numeric',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
};
export const now = () => new Date().toLocaleTimeString('en-US', TIME_FORMAT);
