const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const num = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 });

export const formatPeso = (n: number) => peso.format(n);
export const formatNumber = (n: number) => num.format(n);

/** Today as YYYY-MM-DD in the browser's local time. */
export const todayISO = () => new Date().toLocaleDateString("en-CA");

/** Clock time in the shop's timezone. */
export const formatTime = (iso: string | number) =>
  new Date(iso).toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  });
