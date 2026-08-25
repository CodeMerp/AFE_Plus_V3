import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import axios from 'axios'

import Spinner from 'react-bootstrap/Spinner'
import Container from 'react-bootstrap/Container'


const Questionnaire = () => {
    const router = useRouter()

    const [isLoaded, setIsLoaded] = useState(true)

    useEffect(() => {
        const { id } = router.query
        if(id){
            const idString = Array.isArray(id) ? id[0] : id;
            fetchData(idString)
        }
        console.log("🚀 ~ useEffect ~ id:", id)
    }, [router])

    const fetchData = useCallback(async (id: string) => {
        try {
            const response = await axios.get(`/api/borrowequipment/questionnaire?id=${id}`)
            if (response.data) {
                setIsLoaded(false)
            }
        } catch (error) {
            console.log("🚀 ~ fetchData ~ error", error)
        }
    }, [])

  return (
    <Container>
        {
            isLoaded ? (
                <div className="d-flex justify-content-center align-items-center" style={{ height: '100vh' }}>
                    <Spinner animation="border" variant="primary" />
                </div>
            ):(
                <>
                </>   
            )
        }
    </Container>
  )
}

export default Questionnaire