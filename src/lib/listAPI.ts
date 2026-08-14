import axios from "axios";
import { encrypt, parseQueryString } from '@/utils/helpers'

const urlName = (url: string) => {
    return `${process.env.WEB_DOMAIN}${url}`
}

export const getUser = async (userLineId: string) => {
    const url = urlName(`/api/user/getUser/${userLineId}`)
	const responseUser = await axios.get(url);
	if(responseUser.data?.data){
		return responseUser.data.data
	}else{
		return null
	}
}

export const getTakecareperson = async (takecarepersonId: string, usersId?: number) => {
    const enTakecarepersonId = encrypt(takecarepersonId)
    const qs = usersId !== undefined ? `?users_id=${usersId}` : ''
    const url = urlName(`/api/user/getTakecareperson/${enTakecarepersonId}${qs}`)
	const responseUser = await axios.get(url, {
		headers: { 'x-internal-key': process.env.INTERNAL_API_KEY || '' }
	});
	if(responseUser.data?.data){
		return responseUser.data.data
	}else{
		return null
	}
}

export const getSafezone = async (takecare_id: number, users_id: number) => {
    const url = urlName(`/api/setting/getSafezone?takecare_id=${takecare_id}&users_id=${users_id}`)
	const response = await axios.get(url, {
		headers: { 'x-internal-key': process.env.INTERNAL_API_KEY || '' }
	});
	if(response.data?.data){
		return response.data.data
	}else{
		return null
	}
}

export const getExtendedHelp = async (takecareId: number, usersId: number) => {
    const url = urlName(`/api/extendedhelp?takecareId=${takecareId}&usersId=${usersId}`)
	const response = await axios.get(url);
	if(response.data?.data){
		return response.data.data
	}else{
		return null
	}
}

export const getExtendedHelpById = async (id: number) => {
    const url = urlName(`/api/extendedhelp?extenId=${id}`)
	const response = await axios.get(url);
	if(response.data?.data){
		return response.data.data
	}else{
		return null
	}
}

export const saveExtendedHelp = async (data: any) => {
    try {
        const url = urlName(`/api/extendedhelp`)
        const response = await axios.post(url, data);
        if(response.data?.id){
            return response.data.id
        }else{
            return null
        }
    } catch (error) {
        return error
    }
}

export const updateExtendedHelp = async (data: any) => {
    try {
        const url = urlName(`/api/extendedhelp`)
        const response = await axios.put(url, data);
        if(response.data?.data){
            return response.data.data
        }else{
            return null
        }
    } catch (error) {
        return error
    }
}
	// ทำการexport getlocation
	export const getLocation = async (takecare_id: number, users_id: number, safezone_id: number) => {
    const url = urlName(`/api/location/getLocation?takecare_id=${takecare_id}&users_id=${users_id}&safezone_id=${safezone_id}`);
    const response = await axios.get(url, {
        headers: { 'x-internal-key': process.env.INTERNAL_API_KEY || '' }
    });
    if (response.data?.data) {
        return response.data.data;
    } else {
        return null;
    }
};

