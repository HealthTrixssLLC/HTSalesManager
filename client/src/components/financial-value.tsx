import { useFinancialAccess } from "@/hooks/use-financial-access";

interface FinancialValueProps {
  value: number | string | null | undefined;
  format?: "currency" | "number";
  placeholder?: string;
}

export function FinancialValue({
  value,
  format = "currency",
  placeholder = "—",
}: FinancialValueProps) {
  const canViewFinancials = useFinancialAccess();

  if (!canViewFinancials) {
    return <>{placeholder}</>;
  }

  if (value === null || value === undefined || value === "") {
    return <>{placeholder}</>;
  }

  const numericValue = typeof value === "string" ? parseFloat(value) : value;

  if (isNaN(numericValue)) {
    return <>{placeholder}</>;
  }

  if (format === "currency") {
    return (
      <>
        {new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(numericValue)}
      </>
    );
  }

  return <>{numericValue.toLocaleString()}</>;
}
