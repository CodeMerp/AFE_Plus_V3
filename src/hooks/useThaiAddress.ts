import { useEffect, useMemo, useState } from 'react';

// --- Type Definitions ---
interface SubDistrict {
  id: number;
  name_th: string;
  name_en: string;
  zip_code: string;
}

interface District {
  id: number;
  name_th: string;
  name_en: string;
  sub_districts?: SubDistrict[];
}

interface Province {
  id: number;
  name_th: string;
  name_en: string;
  districts?: District[];
}

// --- Utility Functions ---
const sortByName = <T extends { name_th?: string }>(list: T[] = []): T[] =>
  [...list].sort((a, b) =>
    (a.name_th || "").localeCompare(b.name_th || "", "th")
  );

const getLabel = (item: Province | District | SubDistrict | null): string => {
  if (!item) return "";
  return item.name_th || ""; // แสดงเฉพาะภาษาไทย
};

// --- Custom Hook (Logic Layer) ---
export const useThaiAddress = () => {
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [selected, setSelected] = useState({
    provinceId: "",
    districtId: "",
    subDistrictId: "",
    zipCode: "",
  });

  // Fetch Data
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    fetch(
      "https://raw.githubusercontent.com/kongvut/thai-province-data/refs/heads/master/api/v2/province_with_district_and_sub_district.json?fbclid=IwY2xjawVBe8ZleHRuA2FlbQIxMQBwZG9mA3NydGMGYXBwX2lkATAAAR7ALNPqj9vCG-BjUj-4GcllXMIMuPKIsVvsz_NwaqkwQh3raE_61J5jSAQaDA_aem_XkuFg0GjkTdit02Enj7_1Q",
      { signal: controller.signal }
    )
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setProvinces(sortByName(data)))
      .catch((e) => {
        if (e.name !== "AbortError") setError("Failed to load data.");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  // Derived Lists
  const districts = useMemo<District[]>(() => {
    const prov = provinces.find((p) => p.id === Number(selected.provinceId));
    return sortByName(prov?.districts || []);
  }, [provinces, selected.provinceId]);

  const subDistricts = useMemo<SubDistrict[]>(() => {
    const dist = districts.find((d) => d.id === Number(selected.districtId));
    return sortByName(dist?.sub_districts || []);
  }, [districts, selected.districtId]);

  // Get names by ID
  const getProvinceName = (id: string | number): string => {
    const prov = provinces.find((p) => p.id === Number(id));
    return prov?.name_th || "";
  };

  const getDistrictName = (id: string | number): string => {
    const dist = districts.find((d) => d.id === Number(id));
    return dist?.name_th || "";
  };

  const getSubDistrictName = (id: string | number): string => {
    const subDist = subDistricts.find((s) => s.id === Number(id));
    return subDist?.name_th || "";
  };

  // Handlers
  const setProvince = (id: string) => {
    setSelected({
      provinceId: id,
      districtId: "",
      subDistrictId: "",
      zipCode: "",
    });
  };

  const setDistrict = (id: string) => {
    setSelected((prev) => ({
      ...prev,
      districtId: id,
      subDistrictId: "",
      zipCode: "",
    }));
  };

  const setSubDistrict = (id: string) => {
    const subDist = subDistricts.find((s) => s.id === Number(id));
    setSelected((prev) => ({
      ...prev,
      subDistrictId: id,
      zipCode: subDist?.zip_code ? String(subDist.zip_code) : "", // 🔥 แปลงเป็น string
    }));
  };

  const reset = () =>
    setSelected({
      provinceId: "",
      districtId: "",
      subDistrictId: "",
      zipCode: "",
    });

  // Set initial values (for editing existing data)
  const setInitialValues = (province: string, district: string, subDistrict: string, zipCode?: string) => {
    // Find province ID by name
    const prov = provinces.find((p) => p.name_th === province);
    if (!prov) return;

    setSelected({
      provinceId: String(prov.id),
      districtId: "",
      subDistrictId: "",
      zipCode: zipCode || "",
    });

    // Wait for districts to load, then find district
    setTimeout(() => {
      const dist = prov.districts?.find((d) => d.name_th === district);
      if (!dist) return;

      setSelected(prev => ({
        ...prev,
        districtId: String(dist.id),
      }));

      // Wait for sub-districts to load, then find sub-district
      setTimeout(() => {
        const subDist = dist.sub_districts?.find((s) => s.name_th === subDistrict);
        if (!subDist) return;

        setSelected(prev => ({
          ...prev,
          subDistrictId: String(subDist.id),
          zipCode: subDist.zip_code ? String(subDist.zip_code) : (zipCode || ""), // 🔥 แปลงเป็น string
        }));
      }, 100);
    }, 100);
  };

  return {
    data: { provinces, districts, subDistricts },
    status: { loading, error },
    selected,
    actions: { 
      setProvince, 
      setDistrict, 
      setSubDistrict, 
      reset,
      setInitialValues 
    },
    getNames: {
      getProvinceName,
      getDistrictName,
      getSubDistrictName
    },
    getLabel
  };
};