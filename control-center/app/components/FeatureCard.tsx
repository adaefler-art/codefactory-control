import Link from "next/link";

interface FeatureCardProps {
  href: string;
  title: string;
  description: string;
  bgColor?: string;
}

export default function FeatureCard({
  href,
  title,
  description,
  bgColor = "bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-900/30",
}: FeatureCardProps) {
  return (
    <Link
      href={href}
      className={`block p-6 ${bgColor} border rounded-lg transition-colors`}
    >
      <h2 className="text-xl font-semibold mb-2 text-black dark:text-white">
        {title}
      </h2>
      <p className="text-gray-600 dark:text-gray-400">{description}</p>
    </Link>
  );
}
