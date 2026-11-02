import { Skeleton } from "@/components/ui/skeleton";

export default function InternshipsLoading() {
  return <div className="mx-auto max-w-5xl space-y-7 px-6 py-10" aria-label="Loading internship discovery">
    <Skeleton className="h-10 w-72 max-w-full" />
    <div className="space-y-2"><Skeleton className="h-4 w-full max-w-3xl" /><Skeleton className="h-4 w-2/3" /></div>
    <Skeleton className="h-16 w-full" />
    <Skeleton className="h-11 w-64 max-w-full" />
    <div className="space-y-4"><Skeleton className="h-7 w-80 max-w-full" /><Skeleton className="h-20 w-full max-w-3xl" /></div>
  </div>;
}
