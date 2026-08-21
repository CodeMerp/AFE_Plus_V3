import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import ModalPropsAlert from '@/components/Modals/ModalPropsAlert';

interface LayoutProps {
  children: React.ReactNode;
  title: string;
  description: string;
  slug: string;
  titleBar: string;
}

const MainLayouts: React.FC<LayoutProps> = ({ children, title, description, slug, titleBar }) => {
  const router = useRouter();
  const isNavigationRoute = router.pathname === '/navigation';
  const viewportContent = isNavigationRoute
    ? 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
    : 'initial-scale=1.0, width=device-width';


  const defaultTitle = 'DemoAssist';
  const defaultDescription = 'DemoAssist';



  return (
    <>
      <Head>
        <title>{title ? `${title} | ${defaultTitle}` : defaultTitle}</title>
        <meta name="description" content={description || defaultDescription} />
        <meta name="viewport" content={viewportContent} />
      </Head>
      {children}
      <ModalPropsAlert />
    </>
  );
};

export default MainLayouts;
